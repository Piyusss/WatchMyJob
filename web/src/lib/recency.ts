// Recency labeling is deliberately keyed off firstSeenAt only: JobDrop's
// own discovery timestamp, write-once at the database level (see
// schema.prisma's Job model). Never derived from anything preference- or
// subscription-related: a job doesn't get relabeled "new" just because a
// user widened their filters and it started showing up for them, which
// would be misleading about when it was actually posted/discovered.
export interface RecencyInfo {
  label: string;
  isNew: boolean;
}

export function formatRecency(firstSeenAt: string): RecencyInfo {
  const seenAt = new Date(firstSeenAt);
  const diffMs = Date.now() - seenAt.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return { label: "New · just now", isNew: true };
  if (diffMinutes < 60) return { label: `New · ${diffMinutes} min ago`, isNew: true };

  // A rolling 24h window, not "same calendar date": a job first seen at
  // 11:58pm would otherwise flip from "New today" to a plain "0d ago" two
  // minutes later purely because the wall-clock date rolled over, even
  // though nothing about its actual age changed.
  if (diffHours < 24) return { label: `New today · ${diffHours}h ago`, isNew: true };

  if (diffDays < 7) return { label: `${diffDays}d ago`, isNew: false };

  return {
    label: seenAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    isNew: false,
  };
}
