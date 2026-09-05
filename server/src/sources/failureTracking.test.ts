// The worker's health alert (src/worker.ts) fires off consecutiveFailures
// crossing a threshold across repeated ticks: this locks in that the
// counter actually climbs correctly over multiple failures, not just once,
// and resets cleanly the moment a source recovers.
import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "./sync.js";
import { setAdapterForTesting } from "./registry.js";
import type { JobSourceAdapter } from "./types.js";

const SLUG = `test-failuretrack-${Date.now()}`;
let companyId: string;

const workingAdapter: JobSourceAdapter = {
  discoverJobs: async () => ({
    jobs: [
      {
        externalJobId: "job-1",
        title: "Software Engineer",
        location: null,
        workMode: null,
        description: null,
        sourceUrl: "https://example.test/1",
        postedAt: null,
      },
    ],
    status: "COMPLETE",
  }),
};

const failingAdapter: JobSourceAdapter = {
  discoverJobs: async () => {
    throw new Error("simulated upstream failure");
  },
};

describe("consecutive failure tracking", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "Failure Tracking Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(() => setAdapterForTesting("GREENHOUSE", undefined));

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("climbs by exactly one per failed attempt and resets to zero on the next success", async () => {
    setAdapterForTesting("GREENHOUSE", workingAdapter);
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    const baseline = await syncSource(source, { initial: true });
    assert.equal(baseline.error, null);
    assert.equal(baseline.consecutiveFailures, 0);

    setAdapterForTesting("GREENHOUSE", failingAdapter);
    let current = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    for (const expected of [1, 2, 3]) {
      const result = await syncSource(current);
      assert.ok(result.error, `attempt should fail`);
      assert.equal(result.consecutiveFailures, expected, `failure count after attempt ${expected}`);
      current = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
      assert.equal(current.consecutiveFailures, expected);
    }

    setAdapterForTesting("GREENHOUSE", workingAdapter);
    const recovered = await syncSource(current);
    assert.equal(recovered.error, null);
    assert.equal(recovered.consecutiveFailures, 0, "a successful sync must clear the streak entirely");
  });
});
