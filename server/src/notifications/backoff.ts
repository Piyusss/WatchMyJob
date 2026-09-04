// A count alone can't tell "failed once, transient" from "failed
// repeatedly, something's wrong" -- exponential backoff with a ceiling
// gives a transient provider blip room to clear without hammering it, and
// a genuinely broken send (bad address, provider outage) a bounded number
// of tries before it stops consuming worker cycles.
export const MAX_SEND_ATTEMPTS = 5;

const BASE_DELAY_MINUTES = 2;
const MAX_DELAY_MINUTES = 30;

// attemptCount is the count AFTER the failed attempt that just happened
// (1..MAX_SEND_ATTEMPTS-1 while still eligible to retry).
export function backoffDelayMs(attemptCount: number): number {
  const minutes = Math.min(BASE_DELAY_MINUTES * 2 ** (attemptCount - 1), MAX_DELAY_MINUTES);
  return minutes * 60_000;
}
