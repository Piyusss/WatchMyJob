// Phase 6's actual job: syncSource must diff a rediscovery against current
// Postgres state, not blindly insert-and-skip-duplicates. Covers the three
// outcomes a rediscovered job can have (new / changed / unchanged) and the
// missing-job signal, including that a PARTIAL fetch must not produce one.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import type { DiscoveryResult, JobSourceAdapter, NormalizedJob } from "./types.js";

const SLUG = `test-changedetect-${Date.now()}`;
let companyId: string;

function fakeAdapter(result: DiscoveryResult): JobSourceAdapter {
  return { discoverJobs: async () => result };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalJobId: "job-1",
    title: "Software Engineer",
    location: "Remote",
    workMode: "REMOTE",
    description: "Original description",
    sourceUrl: "https://example.test/jobs/1",
    postedAt: null,
    ...overrides,
  };
}

async function createBaselinedSource() {
  const source = await prisma.jobSource.create({
    data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
  });
  setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job()], status: "COMPLETE" }));
  const initialResult = await syncSource(source, { initial: true });
  assert.equal(initialResult.error, null, "fixture setup: initial sync must succeed");
  return prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
}

describe("change detection", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Change Detection Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("a job rediscovered with identical content: lastSeenAt bumps, nothing else changes", async () => {
    const source = await createBaselinedSource();
    const before = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });

    await new Promise((r) => setTimeout(r, 20)); // ensure a measurable time delta
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job()], status: "COMPLETE" }));
    const result = await syncSource(source);

    assert.equal(result.error, null);
    assert.deepEqual([result.created, result.updated, result.unchanged], [0, 0, 1]);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: before.id } });
    assert.ok(after.lastSeenAt > before.lastSeenAt, "lastSeenAt must advance on rediscovery");
    assert.equal(after.firstSeenAt.getTime(), before.firstSeenAt.getTime(), "firstSeenAt must not move");
    assert.equal(after.lastMatchRelevantChangeAt, null, "no real change happened: must not be stamped");
    assert.equal(after.contentHash, before.contentHash);
  });

  it("a job rediscovered with a changed title: updated, contentHash and lastMatchRelevantChangeAt change, firstSeenAt does not", async () => {
    const source = await createBaselinedSource();
    const before = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });

    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({ jobs: [job({ title: "Senior Software Engineer" })], status: "COMPLETE" }),
    );
    const result = await syncSource(source);

    assert.equal(result.error, null);
    assert.deepEqual([result.created, result.updated, result.unchanged], [0, 1, 0]);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.title, "Senior Software Engineer");
    assert.notEqual(after.contentHash, before.contentHash);
    assert.ok(after.lastMatchRelevantChangeAt !== null, "a genuine content change must stamp this");
    assert.equal(after.firstSeenAt.getTime(), before.firstSeenAt.getTime(), "write-once field must survive an update");
    assert.equal(after.discoveredInInitialSync, true, "the baseline flag must survive an update too");
  });

  it("a genuinely new externalJobId in the same cycle is created, not merged into the existing row", async () => {
    const source = await createBaselinedSource();

    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({ jobs: [job(), job({ externalJobId: "job-2", title: "Product Manager" })], status: "COMPLETE" }),
    );
    const result = await syncSource(source);

    assert.deepEqual([result.created, result.updated, result.unchanged], [1, 0, 1]);
    const newJob = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-2" } });
    assert.equal(newJob.discoveredInInitialSync, false, "a job found by a REGULAR sync is not baseline inventory");
  });

  it("a job missing from a COMPLETE rediscovery is reported as missing but left ACTIVE and untouched", async () => {
    const source = await createBaselinedSource();
    const before = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id, externalJobId: "job-1" } });

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    const result = await syncSource(source);

    assert.equal(result.missing, 1, "a COMPLETE fetch that omits a known job must count it as missing");
    const after = await prisma.job.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.status, "ACTIVE", "Phase 6 only signals: it must never close a job itself");
    assert.equal(after.lastSeenAt.getTime(), before.lastSeenAt.getTime(), "an unseen job's lastSeenAt must stay stale");
  });

  it("a job missing from a PARTIAL rediscovery is NOT counted as missing: absence proves nothing there", async () => {
    const source = await createBaselinedSource();

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "PARTIAL" }));
    const result = await syncSource(source);

    assert.equal(result.missing, null, "PARTIAL must suppress the missing signal entirely, not report 0 or 1");
  });
});
