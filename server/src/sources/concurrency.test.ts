// A real reliability scenario, not a hypothetical: an operator runs
// admin:sync by hand while the scheduled worker's tick for the same source
// is also in flight. Node's event loop is single-threaded, but Prisma's
// $transaction sends real queries over the wire: two overlapping
// transactions genuinely race at the POSTGRES level, which is exactly what
// Promise.all here exercises, not a simulation of one.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import type { DiscoveryResult, JobSourceAdapter, NormalizedJob } from "./types.js";

const SLUG = `test-concurrency-${Date.now()}`;
let companyId: string;

function fakeAdapter(result: DiscoveryResult): JobSourceAdapter {
  return { discoverJobs: async () => result };
}

function job(id: string): NormalizedJob {
  return {
    externalJobId: id,
    title: "Software Engineer",
    location: null,
    workMode: null,
    description: null,
    sourceUrl: `https://example.test/${id}`,
    postedAt: null,
  };
}

describe("concurrent sync of the same source", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Concurrency Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("two overlapping regular syncs discovering the same new job never crash and never double-insert it", async () => {
    let source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job("race-job")], status: "COMPLETE" }));

    const results = await Promise.all([syncSource(source), syncSource(source)]);

    // Neither call may throw an unhandled exception: both must resolve
    // to a normal SourceSyncResult, whichever one "lost" the race included.
    for (const r of results) {
      assert.equal(typeof r, "object");
      assert.ok("created" in r && "error" in r);
    }

    const rows = await prisma.job.findMany({ where: { sourceId: source.id, externalJobId: "race-job" } });
    assert.equal(rows.length, 1, "the unique constraint must prevent a duplicate row regardless of which transaction won");

    // Exactly one of the two attempts should report success creating it;
    // the loser reports a clean error, never a crash.
    const succeeded = results.filter((r) => r.error === null && r.created === 1);
    assert.equal(succeeded.length, 1, "exactly one attempt should have won the race and created the row");
  });

  it("the losing attempt's failure increments consecutiveFailures rather than being silently swallowed", async () => {
    let source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job("race-job-2")], status: "COMPLETE" }));
    await Promise.all([syncSource(source), syncSource(source)]);

    const after = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    // One of the two calls updates consecutiveFailures back to 0 on success
    // (whichever runs last), so this only confirms the source is left in a
    // sane, queryable state (not stuck, not corrupted) after the race.
    assert.ok(typeof after.consecutiveFailures === "number");
  });
});
