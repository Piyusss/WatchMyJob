// The onboarding no-flood rule is the single business rule the whole
// product rests on, and it fails silently -- a broken version looks exactly
// like a working one until real users get a mailbox full of jobs that were
// already open when they signed up. So it gets a real test.
//
// Runs against the dev database with its own throwaway fixtures.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { SELECTABLE_COMPANY } from "../companies/selectable.js";

const SLUG = `test-noflood-${Date.now()}`;
let companyId: string;
let sourceId: string;

async function isSelectable(): Promise<boolean> {
  const found = await prisma.company.findFirst({ where: { slug: SLUG, ...SELECTABLE_COMPANY } });
  return found !== null;
}

describe("onboarding no-flood invariant", () => {
  before(async () => {
    const company = await prisma.company.create({
      data: { name: "No-Flood Test Co", slug: SLUG, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;

    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "irrelevant" } },
    });
    sourceId = source.id;
  });

  after(async () => {
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("a company with a source that has no baseline is not selectable", async () => {
    assert.equal(await isSelectable(), false);
  });

  it("a company with no sources at all is not selectable", async () => {
    const bare = await prisma.company.create({
      data: { name: "Bare", slug: `${SLUG}-bare`, accessBasis: "OFFICIAL_API" },
    });
    const found = await prisma.company.findFirst({ where: { slug: `${SLUG}-bare`, ...SELECTABLE_COMPANY } });
    assert.equal(found, null, "a company with zero sources must never be selectable");
    await prisma.company.delete({ where: { id: bare.id } });
  });

  it("becomes selectable once every source has a committed baseline", async () => {
    await prisma.job.createMany({
      data: [1, 2, 3].map((n) => ({
        companyId,
        sourceId,
        externalJobId: `baseline-${n}`,
        identityHash: `identity-${n}`,
        contentHash: `content-${n}`,
        title: `Pre-existing role ${n}`,
        sourceUrl: `https://example.test/jobs/${n}`,
        discoveredInInitialSync: true,
      })),
    });
    await prisma.jobSource.update({ where: { id: sourceId }, data: { initialSyncCompletedAt: new Date() } });

    assert.equal(await isSelectable(), true);
  });

  it("every baseline job predates a subscription made afterwards, and is flagged pre-existing", async () => {
    const user = await prisma.user.create({
      data: { name: "Late Joiner", email: `${SLUG}@example.test`, clerkUserId: `clerk-${SLUG}` },
    });
    const subscription = await prisma.userCompanySubscription.create({
      data: { userId: user.id, companyId },
    });

    const baselineJobs = await prisma.job.findMany({ where: { companyId } });
    assert.ok(baselineJobs.length > 0, "fixture should have baseline jobs");

    for (const job of baselineJobs) {
      // Two independent protections, either of which alone would suffice.
      assert.ok(
        job.firstSeenAt < subscription.subscribedAt,
        `job ${job.externalJobId} was first seen after the subscription began`,
      );
      assert.equal(
        job.discoveredInInitialSync,
        true,
        `job ${job.externalJobId} is baseline inventory and must be flagged as such`,
      );
    }

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("adding a new source to a live company makes it un-selectable until that source is baselined too", async () => {
    const second = await prisma.jobSource.create({
      data: { companyId, platform: "LEVER", config: { site: "irrelevant" } },
    });

    assert.equal(
      await isSelectable(),
      false,
      "a company with a freshly-added, un-baselined source must not accept new subscribers",
    );

    await prisma.jobSource.update({ where: { id: second.id }, data: { initialSyncCompletedAt: new Date() } });
    assert.equal(await isSelectable(), true);
  });

  it("firstSeenAt cannot be moved once written", async () => {
    const job = await prisma.job.findFirstOrThrow({ where: { companyId } });
    await assert.rejects(
      () => prisma.job.update({ where: { id: job.id }, data: { firstSeenAt: new Date() } }),
      /write-once/,
      "the database must reject any attempt to re-date firstSeenAt",
    );
  });
});
