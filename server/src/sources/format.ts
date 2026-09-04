import type { SourceSyncResult } from "./sync.js";

// Shared between admin:sync (manual, one-shot) and the worker (scheduled)
// so the two never drift into reporting the same result differently -- the
// exact failure mode selectable.ts's own comment warns against, applied
// here to output instead of a query predicate.
export function summarizeSyncResult(result: SourceSyncResult): string {
  const parts = [`discovered ${result.discovered}`];
  if (result.created) parts.push(`${result.created} new`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.reactivated) parts.push(`${result.reactivated} reopened`);
  if (result.closed) parts.push(`${result.closed} closed`);
  if (result.queued) parts.push(`${result.queued} notification(s) queued`);
  if (result.circuitBreakerTripped) {
    parts.push(`⚠ circuit breaker tripped (${result.missing} missing, not acted on)`);
  } else if (result.missing) {
    parts.push(`${result.missing} missing this cycle`);
  }
  return parts.join(", ");
}
