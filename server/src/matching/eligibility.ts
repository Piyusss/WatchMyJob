export type NotificationType = "NEW_JOB" | "MATCH_VIA_UPDATE";

export interface EligibilityContext {
  jobFirstSeenAt: Date;
  // Only ever set for a genuine matching-relevant change (see sync.ts's
  // matchRelevantFieldsChanged) -- never for a routine description edit,
  // narrowing but not eliminating the limitation documented below.
  jobLastMatchRelevantChangeAt: Date | null;
  subscribedAt: Date;
  preferencesEffectiveSince: Date;
}

// Decides WHEN a job that currently matches a user became eligible to
// notify them, and therefore whether it should at all.
//
// KNOWN LIMITATION, stated precisely rather than glossed over: the
// blueprint's rule is "use firstSeenAt, UNLESS the match state only became
// true because of a later change." Telling those apart exactly requires
// knowing whether the job matched THIS USER'S preferences before that
// change too -- which requires a snapshot of historical job state, and no
// such history table exists (Job only stores current values; Phase 6/7
// overwrite in place). What's implemented instead: try firstSeenAt first: if
// the job counts as new to this user's subscription/preference cutoff,
// that alone decides it, full stop. Only if firstSeenAt predates the
// cutoff does a later matching-relevant change get a chance to justify
// notifying anyway.
// This can rarely produce a false positive: a job that already matched
// before the user's cutoff, then received an UNRELATED matching-relevant
// edit after it (e.g. a role_family correction that doesn't change whether
// THIS user's preferences match) would still notify. Narrowing
// lastMatchRelevantChangeAt to only matching-relevant fields (not every
// content change) already shrinks this window substantially; closing it
// completely would require a job-state history table, which is a real
// scope expansion left for a later phase, not a gap to paper over now.
export function evaluateEligibility(ctx: EligibilityContext): NotificationType | null {
  const cutoff = new Date(Math.max(ctx.subscribedAt.getTime(), ctx.preferencesEffectiveSince.getTime()));

  if (ctx.jobFirstSeenAt >= cutoff) return "NEW_JOB";
  if (ctx.jobLastMatchRelevantChangeAt && ctx.jobLastMatchRelevantChangeAt >= cutoff) return "MATCH_VIA_UPDATE";
  return null;
}
