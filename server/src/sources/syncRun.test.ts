// SyncRun is the operational history admin:health (and a future admin UI)
// need to answer "what actually happened the last N times this source was
// synced": these tests exercise that a row is written for every real
// attempt, with the right status and counts, across the paths syncSource
// can take.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import type { DiscoveryResult, JobSourceAdapter, NormalizedJob } from "./types.js";

const SLUG = `test-syncrun-${Date.now()}`;
let companyId: string;

function fakeAdapter(result: DiscoveryResult): JobSourceAdapter {
  return { discoverJobs: async () => result };
}

function failingAdapter(message: string): JobSourceAdapter {
  return {
    discoverJobs: async () => {
      throw new Error(message);
    },
  };
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

async function latestSyncRun(sourceId: string) {
  return prisma.syncRun.findFirstOrThrow({ where: { sourceId }, orderBy: { startedAt: "desc" } });
}

describe("SyncRun history", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "SyncRun Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("records a SUCCESS row with accurate counts for a normal sync", async () => {
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job("a"), job("b")], status: "COMPLETE" }));
    await syncSource(source, { initial: true });

    const run = await latestSyncRun(source.id);
    assert.equal(run.status, "SUCCESS");
    assert.equal(run.jobsDiscovered, 2);
    assert.equal(run.jobsCreated, 2);
    assert.equal(run.error, null);
    assert.ok(run.finishedAt !== null);
    assert.ok(typeof run.durationMs === "number" && run.durationMs >= 0);
  });

  it("records a FAILED row with the error message when the adapter throws", async () => {
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "y" }, initialSyncCompletedAt: new Date() },
    });
    setAdapterForTesting("GREENHOUSE", failingAdapter("board not found"));
    await syncSource(source);

    const run = await latestSyncRun(source.id);
    assert.equal(run.status, "FAILED");
    assert.match(run.error ?? "", /board not found/);
  });

  it("records a FAILED row (not SUCCESS) when the empty-baseline guard rejects the attempt", async () => {
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "z" } },
    });
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true }); // no allowEmpty. Guard rejects

    const run = await latestSyncRun(source.id);
    assert.equal(run.status, "FAILED");
    assert.match(run.error ?? "", /0 jobs/);
  });

  it("records a PARTIAL row when the adapter itself reports an incomplete fetch", async () => {
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "w" } },
    });
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job("p1")], status: "PARTIAL" }));
    await syncSource(source, { initial: true });

    const run = await latestSyncRun(source.id);
    assert.equal(run.status, "PARTIAL");
    assert.equal(run.jobsCreated, 1);
  });

  it("does not create a SyncRun row when an ordering guard rejects before any fetch is attempted", async () => {
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "v" } }, // no baseline yet
    });
    await syncSource(source); // regular sync against a source with no baseline: guard rejects

    const count = await prisma.syncRun.count({ where: { sourceId: source.id } });
    assert.equal(count, 0, "a guard rejection never reached the adapter, so there is no attempt to record");
  });
});
