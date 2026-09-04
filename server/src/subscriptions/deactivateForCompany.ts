import { prisma } from "../db/prisma.js";

// Called whenever a company transitions to INACTIVE -- see
// admin/companies.ts's CLI deactivate and testCompanies/routes.ts's status
// PATCH, the only two places that ever flip Company.status. Left alone, a
// disabled company's subscribers keep an `active: true`
// UserCompanySubscription row, and nothing that reads subscriptions to
// decide what a user is "watching" -- the dashboard job query
// (jobs/routes.ts), the matching engine (matching/engine.ts), or the
// subscriptions list itself (subscriptions/routes.ts) -- checks the
// company's own status at all. Only the final pre-send recheck
// (notifications/preSendCheck.ts) catches it, which is enough to guarantee
// no email actually goes out, but not enough to stop the company from
// still LOOKING watched everywhere else (dashboard feed, subscriptions
// list). Deactivating the subscription itself is the single-source-of-truth
// fix: every one of those call sites already treats `active: false` as "not
// watching," so nothing else needs to learn a second rule.
//
// Uses the exact same active:false/deactivatedAt shape the unsubscribe
// endpoint already writes (subscriptions/routes.ts) -- same "no longer
// watching" state, just reached a different way. If the company is
// reactivated later, subscribers must explicitly re-subscribe rather than
// silently resuming -- the same reasoning that already resets subscribedAt
// on every reactivation (see subscriptions/routes.ts's own comment): a
// stale subscription picking back up on its own is exactly the kind of
// flood the no-flood rule exists to prevent.
export async function deactivateSubscriptionsForCompany(companyId: string): Promise<number> {
  const result = await prisma.userCompanySubscription.updateMany({
    where: { companyId, active: true },
    data: { active: false, deactivatedAt: new Date() },
  });
  return result.count;
}
