// A count alone can't tell a source polling every 60s from one polling
// every 15 minutes apart: 3 misses is 3 minutes for one and 45 for the
// other. A count AND a time floor together are robust to both a single
// flaky poll (needs several misses) and a fast-polling source racking up
// "several" misses in a implausibly short window (needs real elapsed time).
export const CLOSURE_MISS_THRESHOLD = 3;
export const CLOSURE_MIN_MISSING_MS = 30 * 60 * 1000; // 30 minutes

// Below this many previously-active jobs, a "fraction missing" is
// statistically meaningless (1 of 2 is not a signal). Matches the same
// floor reasoning as the fraction threshold itself.
export const CIRCUIT_BREAKER_MIN_SAMPLE = 5;
// Half or more of a source's known-active jobs vanishing in one cycle is
// far more likely to be the source itself breaking (board migration, wrong
// config, upstream outage) than that many real openings closing at once.
// This is the safeguard Section 22 names directly: "temporary source
// failures must never cause mass false closures."
export const CIRCUIT_BREAKER_FRACTION = 0.5;

export interface MissState {
  consecutiveMissCount: number;
  firstMissingAt: Date | null;
}

export interface MissEvaluation {
  consecutiveMissCount: number;
  // Always set on the way out: either carried over from state, or
  // established as "now" on the first miss. Only the input can be null.
  firstMissingAt: Date;
  shouldClose: boolean;
}

// Pure function: given a job's current miss-tracking state and "now", what
// should its next state be? No DB, no clock reads inside: a test can
// assert exact behavior at exact miss counts and durations without waiting
// on real time or faking timers.
export function evaluateMissedJob(state: MissState, now: Date): MissEvaluation {
  const consecutiveMissCount = state.consecutiveMissCount + 1;
  const firstMissingAt = state.firstMissingAt ?? now;
  const elapsedMs = now.getTime() - firstMissingAt.getTime();

  const shouldClose = consecutiveMissCount >= CLOSURE_MISS_THRESHOLD && elapsedMs >= CLOSURE_MIN_MISSING_MS;

  return { consecutiveMissCount, firstMissingAt, shouldClose };
}

// Should this cycle's missing count for a source be trusted at all, or does
// it look like the source itself is the problem? Called once per cycle,
// before touching any individual job's miss state.
export function isCircuitBreakerTripped(activeBeforeCycle: number, missingThisCycle: number): boolean {
  if (activeBeforeCycle < CIRCUIT_BREAKER_MIN_SAMPLE) return false;
  return missingThisCycle / activeBeforeCycle >= CIRCUIT_BREAKER_FRACTION;
}
