// backoff.test.ts and preSendCheck.test.ts cover the pure decision
// functions. This file covers the wiring: does processNotificationBatch
// actually claim, recheck, send (or correctly skip/retry/dead-letter)
// against a real database and a controllable fake provider.
//
// WHY THE SUITE RUNS WITH --test-concurrency=1 (see package.json's `test`).
// processNotificationBatch claims from the notifications table with no user
// or company filter, which is correct in production: a worker should pick up
// any eligible row. It also means this file cannot be isolated from any other
// test file that queues a notification. Run in parallel, node --test starts
// matching/engine.test.ts and webhooks.test.ts alongside this one, a claim
// here picks up one of THEIR rows, and that row is then cascade-deleted out
// from under the transaction: PrismaClientUnknownRequestError, in whichever
// file lost the race. Measured: 2 failures in parallel, 0 serialized.
//
// So the flag is load-bearing, not a performance choice. Removing it makes
// the suite fail intermittently. Fixing it properly means giving the claim
// query an optional scope for tests, which changes production code to suit
// the tests; serializing was judged the smaller cost.
import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../db/prisma.js";
import { processNotificationBatch } from "./pipeline.js";
import { setEmailProviderForTesting } from "../email/index.js";
import type { EmailMessage, EmailProvider, EmailSendResult } from "../email/types.js";
import { MAX_SEND_ATTEMPTS } from "./backoff.js";

const RUN_ID = `test-pipeline-${Date.now()}`;
let companyId: string;
let sourceId: string;
let testIndex = 0;
// Incremented on every call, not just per-test: a test that creates two
// users or two jobs (the multi-notification test does both) needs each
// call to get its own unique identity, not just each test.
let callIndex = 0;

function fakeProvider(behavior: (msg: EmailMessage) => EmailSendResult | never): EmailProvider {
  return { send: async (msg) => behavior(msg) };
}

function alwaysSucceeds(): EmailProvider {
  return fakeProvider(() => ({ providerMessageId: "fake-message-id" }));
}

function alwaysFails(reason = "simulated provider failure"): EmailProvider {
  return {
    send: async () => {
      throw new Error(reason);
    },
  };
}

async function makeUser(overrides: Partial<{ emailVerified: boolean; notificationsPaused: boolean }> = {}) {
  const idx = callIndex++;
  return prisma.user.create({
    data: {
      name: "Pipeline Test User",
      email: `u${idx}-${RUN_ID}@example.test`,
      clerkUserId: `clerk-${idx}-${RUN_ID}`,
      emailVerified: true,
      notificationsPaused: false,
      ...overrides,
    },
  });
}

async function makeJob(overrides: Partial<{ status: "ACTIVE" | "CLOSED" }> = {}) {
  const n = callIndex++;
  return prisma.job.create({
    data: {
      companyId,
      sourceId,
      externalJobId: `job-${n}`,
      identityHash: `identity-${n}`,
      contentHash: `content-${n}`,
      title: "Software Engineer",
      sourceUrl: "https://example.test/job",
      status: "ACTIVE",
      ...overrides,
    },
  });
}

async function makeSubscription(userId: string, active = true) {
  return prisma.userCompanySubscription.create({ data: { userId, companyId, active } });
}

async function makeQueuedNotification(userId: string, jobId: string) {
  return prisma.notification.create({ data: { userId, jobId, notificationType: "NEW_JOB", status: "QUEUED" } });
}

describe("notification pipeline integration", () => {
  beforeEach(async () => {
    testIndex++;
    const slug = `${RUN_ID}-${testIndex}`;
    const company = await prisma.company.create({ data: { name: "Pipeline Test Co", slug, accessBasis: "OFFICIAL_API" } });
    companyId = company.id;
    const source = await prisma.jobSource.create({ data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } } });
    sourceId = source.id;
  });

  afterEach(async () => {
    setEmailProviderForTesting(undefined);
    await prisma.company.delete({ where: { id: companyId } }); // cascades sources/jobs/subscriptions/notifications
    await prisma.user.deleteMany({ where: { email: { endsWith: `${RUN_ID}@example.test` } } });
  });

  after(() => prisma.$disconnect());

  it("a fully valid notification is sent and recorded as PROVIDER_ACCEPTED", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id);
    const notification = await makeQueuedNotification(user.id, job.id);

    let sentTo: string | null = null;
    setEmailProviderForTesting(
      fakeProvider((msg) => {
        sentTo = msg.to;
        return { providerMessageId: "msg-123" };
      }),
    );

    const result = await processNotificationBatch();
    assert.equal(result.claimed, 1);
    assert.equal(result.sent, 1);
    assert.equal(sentTo, user.email);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "PROVIDER_ACCEPTED");
    assert.equal(after.providerMessageId, "msg-123");
    assert.equal(after.attemptCount, 1);
    assert.ok(after.sentAt !== null);
    assert.ok(after.sendingAt !== null, "SENDING must have been persisted en route to PROVIDER_ACCEPTED");
  });

  it("a job that closed after queueing is SKIPPED, and the provider is never called", async () => {
    const user = await makeUser();
    const job = await makeJob({ status: "CLOSED" });
    await makeSubscription(user.id);
    const notification = await makeQueuedNotification(user.id, job.id);

    let called = false;
    setEmailProviderForTesting(fakeProvider(() => { called = true; return { providerMessageId: null }; }));

    const result = await processNotificationBatch();
    assert.equal(result.skipped, 1);
    assert.equal(called, false, "the provider must never be called for a skipped notification");

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "SKIPPED");
    assert.match(after.lastError ?? "", /job is no longer ACTIVE/);
  });

  it("an unsubscribed-since-queueing user is SKIPPED", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id, false);
    await makeQueuedNotification(user.id, job.id);

    setEmailProviderForTesting(alwaysSucceeds());
    const result = await processNotificationBatch();
    assert.equal(result.skipped, 1);
    assert.equal(result.sent, 0);
  });

  it("an unverified email is SKIPPED: Critical Issue #11's fix, exercised end to end", async () => {
    const user = await makeUser({ emailVerified: false });
    const job = await makeJob();
    await makeSubscription(user.id);
    await makeQueuedNotification(user.id, job.id);

    setEmailProviderForTesting(alwaysSucceeds());
    const result = await processNotificationBatch();
    assert.equal(result.skipped, 1);
  });

  it("a paused-since-queueing user is SKIPPED", async () => {
    const user = await makeUser({ notificationsPaused: true });
    const job = await makeJob();
    await makeSubscription(user.id);
    await makeQueuedNotification(user.id, job.id);

    setEmailProviderForTesting(alwaysSucceeds());
    const result = await processNotificationBatch();
    assert.equal(result.skipped, 1);
  });

  it("a provider failure schedules a backoff retry, not an immediate reclaim", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id);
    const notification = await makeQueuedNotification(user.id, job.id);

    setEmailProviderForTesting(alwaysFails("SES throttled"));
    const result = await processNotificationBatch();
    assert.equal(result.failed, 1);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "FAILED");
    assert.equal(after.attemptCount, 1);
    assert.match(after.lastError ?? "", /SES throttled/);
    assert.ok(after.nextAttemptAt !== null && after.nextAttemptAt.getTime() > Date.now(), "must not be immediately retriable");

    // A second pass right away must NOT reclaim it: it's backing off.
    const secondPass = await processNotificationBatch();
    assert.equal(secondPass.claimed, 0);
  });

  it("exhausting the retry ceiling reaches DEAD_LETTER, with an alert-worthy result", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id);
    const notification = await makeQueuedNotification(user.id, job.id);

    setEmailProviderForTesting(alwaysFails("permanent failure"));

    // Drive it through every attempt by clearing nextAttemptAt directly
    // between passes: this test is about the ceiling, not real-time backoff.
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      await prisma.notification.update({ where: { id: notification.id }, data: { nextAttemptAt: null } });
      await processNotificationBatch();
    }

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "DEAD_LETTER");
    assert.equal(after.attemptCount, MAX_SEND_ATTEMPTS);
  });

  it("a notification stuck in SENDING past the threshold is recovered to DEAD_LETTER, never blind-resent", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id);
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        jobId: job.id,
        notificationType: "NEW_JOB",
        status: "SENDING",
        sendingAt: new Date(Date.now() - 10 * 60_000), // stuck for 10 minutes
      },
    });

    let called = false;
    setEmailProviderForTesting(fakeProvider(() => { called = true; return { providerMessageId: "x" }; }));

    const result = await processNotificationBatch();
    assert.equal(result.reconciled, 1);
    assert.equal(called, false, "a recovered ambiguous SENDING row must never be blind-resent");

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "DEAD_LETTER");
  });

  it("a notification freshly in SENDING (not yet past the threshold) is left alone by reconciliation", async () => {
    const user = await makeUser();
    const job = await makeJob();
    await makeSubscription(user.id);
    const notification = await prisma.notification.create({
      data: { userId: user.id, jobId: job.id, notificationType: "NEW_JOB", status: "SENDING", sendingAt: new Date() },
    });

    setEmailProviderForTesting(alwaysSucceeds());
    const result = await processNotificationBatch();
    assert.equal(result.reconciled, 0);
    assert.equal(result.claimed, 0, "a row already in SENDING must not be claimable again while genuinely in flight");

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    assert.equal(after.status, "SENDING", "must be untouched, not silently resolved either way");
  });

  it("processes multiple independently-eligible notifications in one batch", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const jobA = await makeJob();
    const jobB = await makeJob();
    await makeSubscription(userA.id);
    await makeSubscription(userB.id);
    await makeQueuedNotification(userA.id, jobA.id);
    await makeQueuedNotification(userB.id, jobB.id);

    setEmailProviderForTesting(alwaysSucceeds());
    const result = await processNotificationBatch();
    assert.equal(result.claimed, 2);
    assert.equal(result.sent, 2);
  });
});
