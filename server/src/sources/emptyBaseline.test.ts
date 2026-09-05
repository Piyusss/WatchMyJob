// Covers the confirmed finding from the Phase 5 adversarial audit: an
// initial sync that discovers zero jobs must not silently commit a
// baseline. Once committed, the guard against re-running initial sync means
// there is no way back: every job the source turns up afterwards would be
// imported as brand-new, for a company that looks fully onboarded.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import type { JobSourceAdapter, NormalizedJob } from "./types.js";

const SLUG = `test-emptybaseline-${Date.now()}`;
let companyId: string;

function fakeAdapter(jobs: NormalizedJob[]): JobSourceAdapter {
  return { discoverJobs: async () => ({ jobs, status: "COMPLETE" }) };
}

const SAMPLE_JOB: NormalizedJob = {
  externalJobId: "job-1",
  title: "Software Engineer",
  location: "Remote",
  workMode: "REMOTE",
  description: null,
  sourceUrl: "https://example.test/jobs/1",
  postedAt: null,
};

describe("empty-baseline guard", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Empty Baseline Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("refuses to commit a baseline when the adapter returns zero jobs, without allowEmpty", async () => {
    setAdapterForTesting("GREENHOUSE", fakeAdapter([]));
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });

    const result = await syncSource(source, { initial: true });

    assert.match(result.error ?? "", /found 0 jobs/);
    assert.equal(result.created, 0);

    const after = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    assert.equal(after.initialSyncCompletedAt, null, "a zero-job initial sync must not commit a baseline");
  });

  it("commits the baseline for zero jobs when the operator explicitly passes allowEmpty", async () => {
    setAdapterForTesting("GREENHOUSE", fakeAdapter([]));
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });

    const result = await syncSource(source, { initial: true, allowEmpty: true });

    assert.equal(result.error, null);
    const after = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    assert.ok(after.initialSyncCompletedAt !== null, "an explicitly-confirmed empty board must be allowed to baseline");
  });

  it("a non-empty initial sync is unaffected by the guard and flags every row as pre-existing", async () => {
    setAdapterForTesting("GREENHOUSE", fakeAdapter([SAMPLE_JOB]));
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });

    const result = await syncSource(source, { initial: true });

    assert.equal(result.error, null);
    assert.equal(result.created, 1);
    const job = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id } });
    assert.equal(job.discoveredInInitialSync, true);
  });

  it("the guard does not apply to a regular (non-initial) sync: zero jobs there is unremarkable", async () => {
    setAdapterForTesting("GREENHOUSE", fakeAdapter([SAMPLE_JOB]));
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" }, initialSyncCompletedAt: new Date() },
    });

    setAdapterForTesting("GREENHOUSE", fakeAdapter([]));
    const result = await syncSource(source);

    assert.equal(result.error, null, "a regular sync finding zero jobs is not an error: everything just closed");
  });
});
