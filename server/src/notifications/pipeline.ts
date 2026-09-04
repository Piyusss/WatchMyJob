import { prisma } from "../db/prisma.js";
import { getEmailProvider } from "../email/index.js";
import { jobMatchEmail } from "../email/jobMatchEmail.js";
import { evaluatePreSendCheck } from "./preSendCheck.js";
import { backoffDelayMs, MAX_SEND_ATTEMPTS } from "./backoff.js";
import { env } from "../config/env.js";

const CLAIM_BATCH_SIZE = 20;
// How long a row can sit in SENDING before restart-reconciliation treats
// it as ambiguous -- comfortably longer than any single send call should
// plausibly take.
const SENDING_STUCK_THRESHOLD_MS = 2 * 60_000;

export interface ProcessResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  deadLettered: number;
  reconciled: number;
}

// Claims a batch atomically via FOR UPDATE SKIP LOCKED -- safe even if two
// worker processes ran concurrently, though this project runs one -- and
// transitions every claimed row to SENDING inside the SAME transaction,
// before the function returns. This is the actual fix for "worker crashes
// after the provider accepts but before the DB records it": the row is
// marked SENDING before the provider is ever called, not after.
async function claimBatch(limit: number): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notifications
      WHERE status = 'QUEUED'
         OR (status = 'FAILED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await tx.notification.updateMany({
        where: { id: { in: ids } },
        data: { status: "SENDING", sendingAt: new Date() },
      });
    }
    return ids;
  });
}

// A row stuck in SENDING past the threshold means the provider call's
// outcome is genuinely unknown -- SES offers no cheap "did I already send
// this" lookup without wiring SNS/CloudWatch event notifications, real
// added infrastructure out of scope here. Never auto-retried: this
// product's own priorities (the entire onboarding-flood design) value
// under-notifying over risking a duplicate, so an ambiguous row goes
// straight to DEAD_LETTER for a human to look at, not back into the queue.
async function reconcileStuckSending(): Promise<number> {
  const cutoff = new Date(Date.now() - SENDING_STUCK_THRESHOLD_MS);
  const { count } = await prisma.notification.updateMany({
    where: { status: "SENDING", sendingAt: { lt: cutoff } },
    data: {
      status: "DEAD_LETTER",
      lastError:
        "Recovered from SENDING on restart: the provider call's outcome is unknown, never auto-retried to avoid a possible duplicate send.",
    },
  });
  return count;
}

async function processOne(id: string): Promise<"sent" | "skipped" | "failed" | "dead_letter"> {
  const notification = await prisma.notification.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          emailVerified: true,
          notificationsPaused: true,
          emailHardBounced: true,
          unsubscribeToken: true,
        },
      },
      job: {
        select: {
          title: true,
          roleFamily: true,
          level: true,
          location: true,
          workMode: true,
          opportunityType: true,
          sourceUrl: true,
          status: true,
          company: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
  if (!notification) return "skipped"; // nothing to do -- shouldn't happen given onDelete: Cascade

  const subscription = await prisma.userCompanySubscription.findUnique({
    where: { userId_companyId: { userId: notification.userId, companyId: notification.job.company.id } },
    select: { active: true },
  });

  // Everything re-verified fresh, right now -- never trusted from whatever
  // was true when this row was queued (Section 28, generalized to every
  // condition that could have changed in the gap, not just job.status).
  const check = evaluatePreSendCheck({
    jobStatus: notification.job.status,
    companyStatus: notification.job.company.status,
    subscriptionActive: subscription?.active ?? false,
    userEmailVerified: notification.user.emailVerified,
    userNotificationsPaused: notification.user.notificationsPaused,
    userEmailHardBounced: notification.user.emailHardBounced,
  });

  if (!check.ok) {
    await prisma.notification.update({ where: { id }, data: { status: "SKIPPED", lastError: check.reason } });
    return "skipped";
  }

  const content = jobMatchEmail({
    userName: notification.user.name,
    companyName: notification.job.company.name,
    jobTitle: notification.job.title,
    roleFamily: notification.job.roleFamily,
    level: notification.job.level,
    location: notification.job.location,
    workMode: notification.job.workMode,
    opportunityType: notification.job.opportunityType,
    jobUrl: notification.job.sourceUrl,
    unsubscribeUrl: `${env.FRONTEND_URL}/unsubscribe?token=${notification.user.unsubscribeToken}`,
  });

  const attemptCount = notification.attemptCount + 1;

  try {
    const result = await getEmailProvider().send({ to: notification.user.email, ...content });
    await prisma.notification.update({
      where: { id },
      data: { status: "PROVIDER_ACCEPTED", sentAt: new Date(), providerMessageId: result.providerMessageId, attemptCount },
    });
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (attemptCount >= MAX_SEND_ATTEMPTS) {
      await prisma.notification.update({
        where: { id },
        data: { status: "DEAD_LETTER", attemptCount, lastError: message },
      });
      return "dead_letter";
    }

    await prisma.notification.update({
      where: { id },
      data: {
        status: "FAILED",
        attemptCount,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + backoffDelayMs(attemptCount)),
      },
    });
    return "failed";
  }
}

// One pass: reconcile anything stuck from a prior crash, claim a batch,
// process each claimed row to a terminal-for-this-attempt outcome. Kept as
// its own function so both the worker's tick loop and a manual admin
// trigger call exactly this, not separate reimplementations.
export async function processNotificationBatch(limit = CLAIM_BATCH_SIZE): Promise<ProcessResult> {
  const reconciled = await reconcileStuckSending();

  const ids = await claimBatch(limit);
  const result: ProcessResult = { claimed: ids.length, sent: 0, skipped: 0, failed: 0, deadLettered: 0, reconciled };

  for (const id of ids) {
    const outcome = await processOne(id);
    if (outcome === "sent") result.sent++;
    else if (outcome === "skipped") result.skipped++;
    else if (outcome === "failed") result.failed++;
    else result.deadLettered++;
  }

  return result;
}
