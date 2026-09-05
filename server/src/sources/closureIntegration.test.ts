// closure.test.ts covers the pure decision function in isolation.
// This file covers the WIRING: does syncSource actually read/write the
// right rows, in the right order, when a job goes missing for real across
// real syncSource calls: including the case Phase 6's diff logic could
// not have survived on its own (a closed job's externalJobId reappearing,
// which collides with the unique constraint unless reactivation is handled
// explicitly).
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import { CLOSURE_MIN_MISSING_MS } from "./closure.js";
import type { DiscoveryResult, JobSourceAdapter, NormalizedJob } from "./types.js";

const SLUG = `test-closure-${Date.now()}`;
let companyId: string;

function fakeAdapter(result: DiscoveryResult): JobSourceAdapter {
  return { discoverJobs: async () => result };
}

function makeJob(id: string, title = "Software Engineer"): NormalizedJob {
  return {
    externalJobId: id,
    title,
    location: null,
    workMode: null,
    description: null,
    sourceUrl: `https://example.test/jobs/${id}`,
    postedAt: null,
  };
}

async function baselinedSource(jobIds: string[]) {
  const source = await prisma.jobSource.create({
    data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
  });
  setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: jobIds.map((id) => makeJob(id)), status: "COMPLETE" }));
  const result = await syncSource(source, { initial: true });
  assert.equal(result.error, null, "fixture setup: initial sync must succeed");
  return prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
}

describe("closure integration", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Closure Integration Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("a job that reappears before closing has its miss streak fully reset", async () => {
    const source = await baselinedSource(["job-1"]);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source);
    let job = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });
    assert.equal(job.consecutiveMissCount, 1);
    assert.ok(job.firstMissingAt !== null);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [makeJob("job-1")], status: "COMPLETE" }));
    await syncSource(source);
    job = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(job.status, "ACTIVE");
    assert.equal(job.consecutiveMissCount, 0, "reappearance must fully reset the streak");
    assert.equal(job.firstMissingAt, null);
  });

  it("a job that misses enough times, for long enough, actually closes: and then drops out of the dashboard query", async () => {
    const source = await baselinedSource(["job-1"]);
    const job = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });

    // Simulate "2 misses ago, past the time floor" as a precondition,
    // rather than waiting 30 real minutes: this tests the wiring
    // (DB read -> evaluateMissedJob -> DB write) against a controlled
    // state, the same way the pure closure.test.ts controls "now".
    await prisma.job.update({
      where: { id: job.id },
      data: { consecutiveMissCount: 2, firstMissingAt: new Date(Date.now() - CLOSURE_MIN_MISSING_MS - 1000) },
    });

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    const result = await syncSource(source); // 3rd miss, time floor already satisfied

    assert.equal(result.closed, 1);
    const closedJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(closedJob.status, "CLOSED");
    assert.equal(closedJob.consecutiveMissCount, 3);

    // The hard rule this whole phase serves: closed jobs must not appear
    // in the active dashboard query (src/jobs/routes.ts uses this same
    // status: "ACTIVE" filter).
    const activeJobs = await prisma.job.findMany({ where: { companyId, status: "ACTIVE" } });
    assert.equal(activeJobs.find((j) => j.id === job.id), undefined);
  });

  it("a closed job's externalJobId reappearing is a reactivation, not a unique-constraint crash", async () => {
    const source = await baselinedSource(["job-1"]);
    const original = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });

    await prisma.job.update({
      where: { id: original.id },
      data: { status: "CLOSED", consecutiveMissCount: 3, firstMissingAt: new Date() },
    });

    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({ jobs: [makeJob("job-1", "Software Engineer II")], status: "COMPLETE" }),
    );
    const result = await syncSource(source);

    assert.equal(result.error, null, "must not crash on the unique constraint");
    assert.equal(result.reactivated, 1);
    assert.equal(result.created, 0, "must reopen the existing row, not attempt a duplicate insert");

    const reopened = await prisma.job.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(reopened.status, "ACTIVE");
    assert.equal(reopened.title, "Software Engineer II", "reactivation should refresh content too");
    assert.equal(reopened.consecutiveMissCount, 0);
    assert.equal(reopened.firstMissingAt, null);
    assert.equal(reopened.firstSeenAt.getTime(), original.firstSeenAt.getTime(), "write-once field must survive reactivation");
    assert.ok(reopened.lastMatchRelevantChangeAt !== null, "reopening is a newly-relevant event for the future notify predicate");
  });

  it("the circuit breaker trips live: no miss counters touched, nothing closes, even at 3 consecutive missing cycles", async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `job-${i}`);
    const source = await baselinedSource(ids);

    const survivors = [makeJob("job-0"), makeJob("job-1")];
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: survivors, status: "COMPLETE" }));

    let last;
    for (let cycle = 0; cycle < 3; cycle++) {
      last = await syncSource(source);
      assert.equal(last.circuitBreakerTripped, true);
      assert.equal(last.missing, 4);
      assert.equal(last.closed, 0);
    }

    const missingJobs = await prisma.job.findMany({ where: { sourceId: source.id, externalJobId: { in: ids.slice(2) } } });
    for (const job of missingJobs) {
      assert.equal(job.status, "ACTIVE", "circuit breaker must prevent closure even after 3 tripped cycles");
      assert.equal(job.consecutiveMissCount, 0, "a tripped cycle must not advance the miss streak at all");
      assert.equal(job.firstMissingAt, null);
    }
  });
});
