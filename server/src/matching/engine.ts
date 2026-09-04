import { prisma } from "../db/prisma.js";
import { matchesPreferences } from "./predicate.js";
import { evaluateEligibility } from "./eligibility.js";

// Company-active and user-paused checks are deliberately NOT here -- the
// blueprint's own predicate puts them at SEND time (Phase 10's final
// pre-send recheck), not match time. A QUEUED row here records "this user
// was eligible when matched"; whether it's still safe to actually deliver
// is re-verified right before sending, since a lot can change in the gap.

const JOB_SELECT = {
  id: true,
  companyId: true,
  status: true,
  roleFamily: true,
  level: true,
  location: true,
  workMode: true,
  opportunityType: true,
  experienceStatus: true,
  requiredExperienceMin: true,
  requiredExperienceMax: true,
  firstSeenAt: true,
  lastMatchRelevantChangeAt: true,
} as const;

const PREFERENCES_SELECT = {
  roleFamily: true,
  roleLevel: true,
  yearsExperience: true,
  toleranceYears: true,
  workMode: true,
  opportunityTypes: true,
  effectiveSince: true,
  locations: { select: { countryName: true, stateName: true, cityName: true } },
} as const;

async function queueNotification(userId: string, jobId: string, notificationType: "NEW_JOB" | "MATCH_VIA_UPDATE") {
  // Atomic upsert, not check-then-insert: the unique constraint on
  // (userId, jobId, notificationType) is what actually enforces
  // idempotency under concurrent matching passes, not this call being the
  // only writer.
  const { count } = await prisma.notification.createMany({
    data: [{ userId, jobId, notificationType }],
    skipDuplicates: true,
  });
  return count > 0;
}

// Re-evaluates ONE job against every currently-active subscriber of its
// company. Called after a job is created, meaningfully updated, or
// reactivated (see sync.ts's matchableJobIds) -- never for a baseline
// (discoveredInInitialSync) job, which sync.ts excludes before this is
// ever reached.
export async function matchJobAgainstSubscribers(jobId: string): Promise<number> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_SELECT });
  if (!job || job.status !== "ACTIVE") return 0;

  const subscriptions = await prisma.userCompanySubscription.findMany({
    where: { companyId: job.companyId, active: true },
    select: {
      userId: true,
      subscribedAt: true,
      user: { select: { preferences: { select: PREFERENCES_SELECT } } },
    },
  });

  let queued = 0;
  for (const sub of subscriptions) {
    const prefs = sub.user.preferences;
    if (!prefs) continue; // hasn't configured preferences yet -- nothing to match against

    if (!matchesPreferences(job, prefs)) continue;

    const notificationType = evaluateEligibility({
      jobFirstSeenAt: job.firstSeenAt,
      jobLastMatchRelevantChangeAt: job.lastMatchRelevantChangeAt,
      subscribedAt: sub.subscribedAt,
      preferencesEffectiveSince: prefs.effectiveSince,
    });
    if (!notificationType) continue;

    if (await queueNotification(sub.userId, job.id, notificationType)) queued++;
  }
  return queued;
}

// Re-evaluates every currently-ACTIVE job across a user's subscribed
// companies against their CURRENT preferences. Called right after a
// preference save that bumped effectiveSince (see preferences/routes.ts) --
// the dashboard already reflects new preferences on every load; this is
// what makes the notification side of a widened preference correct too,
// instead of only ever catching jobs discovered after the fact.
export async function matchUserAgainstActiveJobs(userId: string): Promise<number> {
  const [preferences, subscriptions] = await Promise.all([
    prisma.userPreferences.findUnique({ where: { userId }, select: PREFERENCES_SELECT }),
    prisma.userCompanySubscription.findMany({
      where: { userId, active: true },
      select: { companyId: true, subscribedAt: true },
    }),
  ]);
  if (!preferences || subscriptions.length === 0) return 0;

  const subscriptionByCompany = new Map(subscriptions.map((s) => [s.companyId, s]));
  const jobs = await prisma.job.findMany({
    where: { companyId: { in: [...subscriptionByCompany.keys()] }, status: "ACTIVE" },
    select: JOB_SELECT,
  });

  let queued = 0;
  for (const job of jobs) {
    if (!matchesPreferences(job, preferences)) continue;

    const subscription = subscriptionByCompany.get(job.companyId)!;
    const notificationType = evaluateEligibility({
      jobFirstSeenAt: job.firstSeenAt,
      jobLastMatchRelevantChangeAt: job.lastMatchRelevantChangeAt,
      subscribedAt: subscription.subscribedAt,
      preferencesEffectiveSince: preferences.effectiveSince,
    });
    if (!notificationType) continue;

    if (await queueNotification(userId, job.id, notificationType)) queued++;
  }
  return queued;
}
