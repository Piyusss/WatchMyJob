// Everything that could have changed between when this notification was
// QUEUED (match time) and now (send time). Section 28's own example --
// "a job can close while its notification is waiting in a queue" --
// generalizes to every one of these: the user could have unsubscribed,
// paused notifications, or never verified their email in the meantime.
// Re-verified fresh from the database immediately before sending, never
// trusted from whatever was true when the row was queued.
export interface PreSendCheckInput {
  jobStatus: "ACTIVE" | "CLOSED";
  companyStatus: "ACTIVE" | "INACTIVE";
  subscriptionActive: boolean;
  userEmailVerified: boolean;
  userNotificationsPaused: boolean;
  // Set by a PERMANENT SES bounce event (see notifications/webhooks.ts).
  // Checked the same way notificationsPaused is: suppress the send rather
  // than retrying an address that will only ever bounce again.
  userEmailHardBounced: boolean;
}

export type PreSendCheckResult = { ok: true } | { ok: false; reason: string };

// Order matters only for which reason gets reported when several are true
// at once -- every failing condition independently blocks the send.
export function evaluatePreSendCheck(input: PreSendCheckInput): PreSendCheckResult {
  if (input.jobStatus !== "ACTIVE") return { ok: false, reason: "job is no longer ACTIVE" };
  if (input.companyStatus !== "ACTIVE") return { ok: false, reason: "company is no longer ACTIVE" };
  if (!input.subscriptionActive) return { ok: false, reason: "user is no longer subscribed to this company" };
  if (!input.userEmailVerified) return { ok: false, reason: "user's email is not verified" };
  if (input.userNotificationsPaused) return { ok: false, reason: "user has paused notifications" };
  if (input.userEmailHardBounced) return { ok: false, reason: "user's email address has permanently bounced" };
  return { ok: true };
}
