// predicate.test.ts and eligibility.test.ts cover the two pure decision
// functions in isolation. This file covers the WIRING through the real
// pipeline: does a real syncSource call, against a real subscribed user
// with real preferences, actually produce (or correctly withhold) a
// Notification row -- including the two behaviors that only exist at the
// integration level: baseline jobs never entering the matching pass at
// all, and idempotency under the real unique constraint.
import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { syncSource } from "../sources/sync.js";
import { matchJobAgainstSubscribers, matchUserAgainstActiveJobs } from "./engine.js";
import { setAdapterForTesting } from "../sources/registry.js";
import type { DiscoveryResult, JobSourceAdapter, NormalizedJob } from "../sources/types.js";

const RUN_ID = `test-matching-${Date.now()}`;
// matchJobAgainstSubscribers/matchUserAgainstActiveJobs correctly operate
// at the WHOLE-COMPANY level (every subscriber, every active job) --
// exactly what production needs, but it means sharing one company across
// tests in this file would leak every earlier test's subscribers and jobs
// into every later test's matching pass. Each test gets its own company.
let companyId: string;
let slug: string;
let testIndex = 0;

function fakeAdapter(result: DiscoveryResult): JobSourceAdapter {
  return { discoverJobs: async () => result };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalJobId: "job-1",
    title: "Software Engineer",
    location: null,
    workMode: null,
    description: null,
    sourceUrl: "https://example.test/1",
    postedAt: null,
    ...overrides,
  };
}

async function makeUser(emailSuffix: string) {
  // RUN_ID is timestamped, so a run that fails partway (leaving rows behind
  // that this suite's own cleanup can't reach, since users aren't cascaded
  // from company deletion) never collides with the next run's attempt.
  return prisma.user.create({
    data: { name: "Test User", email: `${emailSuffix}-${RUN_ID}@example.test`, clerkUserId: `clerk-${emailSuffix}-${RUN_ID}` },
  });
}

async function subscribe(userId: string, subscribedAt?: Date) {
  const sub = await prisma.userCompanySubscription.create({ data: { userId, companyId } });
  if (subscribedAt) {
    await prisma.userCompanySubscription.update({ where: { id: sub.id }, data: { subscribedAt } });
  }
  return prisma.userCompanySubscription.findUniqueOrThrow({ where: { id: sub.id } });
}

async function setPreferences(userId: string, data: Record<string, unknown>) {
  await prisma.userPreferences.create({ data: { userId, ...data } });
}

async function createSource() {
  return prisma.jobSource.create({ data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } } });
}

// syncSource's ordering guard reads initialSyncCompletedAt off the object
// it's handed -- reusing the pre-baseline in-memory `source` for a
// follow-up call looks identical to never having baselined it at all, and
// the ordering guard correctly (if confusingly, for a test) refuses it.
// Every baseline call must be followed by a re-fetch before the same
// variable is used for a subsequent syncSource call.
async function refetch(sourceId: string) {
  return prisma.jobSource.findUniqueOrThrow({ where: { id: sourceId } });
}

describe("matching engine integration", () => {
  beforeEach(async () => {
    slug = `${RUN_ID}-${testIndex++}`;
    const company = await prisma.company.create({
      data: { name: "Matching Test Co", slug, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
  });

  afterEach(async () => {
    setAdapterForTesting("GREENHOUSE", undefined);
    await prisma.company.delete({ where: { id: companyId } }); // cascades sources/jobs/subscriptions/notifications
    await prisma.user.deleteMany({ where: { email: { endsWith: `${RUN_ID}@example.test` } } });
  });

  after(() => prisma.$disconnect());

  it("a genuinely new job matching a subscriber's preferences produces exactly one NEW_JOB notification", async () => {
    const user = await makeUser("newjob-match");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true }); // establish baseline with zero jobs
    source = await refetch(source.id);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    const result = await syncSource(source);

    assert.equal(result.created, 1);
    assert.equal(result.queued, 1);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notificationType, "NEW_JOB");
  });

  it("a baseline (pre-existing) job NEVER enters the matching pass, even when it matches perfectly", async () => {
    const user = await makeUser("baseline-noflood");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const source = await createSource();
    // The user is already subscribed and already has matching preferences
    // BEFORE this company's baseline is even established -- the exact
    // "new company added, existing subscriber" case the flag protects.
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    const result = await syncSource(source, { initial: true });

    assert.equal(result.created, 1);
    assert.equal(result.queued, 0, "baseline import must never queue a notification, no matter how well it matches");

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);
  });

  it("re-syncing an unchanged job does not re-trigger matching or duplicate the notification", async () => {
    const user = await makeUser("idempotent");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    await syncSource(source); // creates + notifies

    const secondResult = await syncSource(source); // identical content -> "unchanged"
    assert.equal(secondResult.created, 0);
    assert.equal(secondResult.updated, 0);
    assert.equal(secondResult.queued, 0, "an unchanged job must not even re-enter the matching pass");

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
  });

  it("calling the matcher twice for the same already-matched job is idempotent at the database level", async () => {
    const user = await makeUser("double-call");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    await syncSource(source); // genuinely new, matches -> queues once already
    const dbJob = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id } });

    // Directly call the matcher again, simulating a redundant invocation --
    // the unique constraint is the actual enforcement, not "only call it
    // once".
    const secondCallQueuedCount = await matchJobAgainstSubscribers(dbJob.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id, jobId: dbJob.id } });
    assert.equal(notifications.length, 1, "still exactly one notification after the redundant call");
    assert.equal(secondCallQueuedCount, 0, "the redundant call itself must report nothing newly queued");
  });

  it("the core onboarding rule through the real engine: a job that predates the subscription does not notify", async () => {
    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    await syncSource(source); // job now exists, firstSeenAt = now, no subscriber yet

    // A user subscribes AFTER the job already existed.
    const user = await makeUser("late-subscriber");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const dbJob = await prisma.job.findFirstOrThrow({ where: { sourceId: source.id } });
    await matchJobAgainstSubscribers(dbJob.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0, "the job existed before this user's subscription -- dashboard-only, never notified");
  });

  it("a non-matching job never queues, and a subsequent matching-relevant edit fires MATCH_VIA_UPDATE", async () => {
    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    // Posted requiring far more experience than the eventual subscriber has.
    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({
        jobs: [job({ description: "&lt;li&gt;10+ years of experience&lt;/li&gt;" })],
        status: "COMPLETE",
      }),
    );
    const createResult = await syncSource(source);
    assert.equal(createResult.queued, 0);

    const user = await makeUser("match-via-update");
    await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer", yearsExperience: 1, toleranceYears: 1 });

    // No notification yet -- it genuinely didn't match at subscribe time.
    let notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);

    // Corrected to an entry-level requirement.
    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({
        jobs: [job({ description: "&lt;li&gt;0-2 years of experience&lt;/li&gt;" })],
        status: "COMPLETE",
      }),
    );
    const updateResult = await syncSource(source);
    assert.equal(updateResult.updated, 1);
    assert.equal(updateResult.queued, 1);

    notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notificationType, "MATCH_VIA_UPDATE");
  });

  it("preference widening: matchUserAgainstActiveJobs does not flood on jobs that predate the widen", async () => {
    const user = await makeUser("widen-noflood");
    await subscribe(user.id, new Date(Date.now() - 86_400_000)); // subscribed a day ago
    // Narrow preference that excludes the existing job.
    await setPreferences(user.id, { roleFamily: "Product Manager" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    await syncSource(source); // exists, doesn't match the narrow preference, nothing queued

    // Widen the preference directly (bypassing the HTTP layer, which is
    // tested separately) and re-run the same matching pass the route calls.
    await prisma.userPreferences.update({
      where: { userId: user.id },
      data: { roleFamily: "Software Engineer", effectiveSince: new Date() },
    });
    await matchUserAgainstActiveJobs(user.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0, "a job that already existed before the widen must stay dashboard-only");
  });

  it("preference widening: a job created AFTER the widen correctly notifies", async () => {
    const user = await makeUser("widen-then-new");
    await subscribe(user.id, new Date(Date.now() - 86_400_000));
    await setPreferences(user.id, { roleFamily: "Product Manager" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    await prisma.userPreferences.update({
      where: { userId: user.id },
      data: { roleFamily: "Software Engineer", effectiveSince: new Date() },
    });

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    const result = await syncSource(source); // job appears after the widen

    assert.equal(result.queued, 1);
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notificationType, "NEW_JOB");
  });

  it("an inactive (unsubscribed) user is never matched even if everything else lines up", async () => {
    const user = await makeUser("unsubscribed");
    const sub = await subscribe(user.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });
    await prisma.userCompanySubscription.update({ where: { id: sub.id }, data: { active: false } });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [job({ title: "Software Engineer" })], status: "COMPLETE" }));
    const result = await syncSource(source);

    assert.equal(result.queued, 0);
  });

  it("one job matching several subscribers at once notifies each of them exactly once, independently", async () => {
    // A README/Phase 12 named scenario ("Multiple matching users") that
    // was never actually exercised: matchJobAgainstSubscribers loops over
    // every subscriber, but nothing had confirmed several REAL matches in
    // one pass stay independent -- no cross-user interference, no partial
    // failures, no accidental sharing of the unique-constraint slot.
    const matchingA = await makeUser("multi-a");
    const matchingB = await makeUser("multi-b");
    const nonMatching = await makeUser("multi-c");
    await Promise.all([subscribe(matchingA.id), subscribe(matchingB.id), subscribe(nonMatching.id)]);
    await setPreferences(matchingA.id, { roleFamily: "Software Engineer" });
    await setPreferences(matchingB.id, { roleFamily: "Software Engineer", yearsExperience: 3, toleranceYears: 1 });
    await setPreferences(nonMatching.id, { roleFamily: "Product Manager" });

    let source = await createSource();
    setAdapterForTesting("GREENHOUSE", fakeAdapter({ jobs: [], status: "COMPLETE" }));
    await syncSource(source, { initial: true, allowEmpty: true });
    source = await refetch(source.id);

    setAdapterForTesting(
      "GREENHOUSE",
      fakeAdapter({
        jobs: [job({ title: "Software Engineer", description: "&lt;li&gt;3+ years of experience&lt;/li&gt;" })],
        status: "COMPLETE",
      }),
    );
    const result = await syncSource(source);

    assert.equal(result.queued, 2, "exactly the two genuinely-matching subscribers, not three, not one");

    const [notifsA, notifsB, notifsC] = await Promise.all(
      [matchingA, matchingB, nonMatching].map((u) => prisma.notification.findMany({ where: { userId: u.id } })),
    );
    assert.equal(notifsA.length, 1);
    assert.equal(notifsB.length, 1);
    assert.equal(notifsC.length, 0, "the non-matching subscriber must not be touched by the other two matching");
    assert.notEqual(notifsA[0].id, notifsB[0].id, "each subscriber gets their own independent notification row");
  });
});
