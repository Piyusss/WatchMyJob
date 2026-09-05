import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMissedJob,
  isCircuitBreakerTripped,
  CLOSURE_MISS_THRESHOLD,
  CLOSURE_MIN_MISSING_MS,
  CIRCUIT_BREAKER_MIN_SAMPLE,
  CIRCUIT_BREAKER_FRACTION,
} from "./closure.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");
function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

describe("evaluateMissedJob", () => {
  it("a single miss never closes, regardless of elapsed time", () => {
    const result = evaluateMissedJob({ consecutiveMissCount: 0, firstMissingAt: null }, T0);
    assert.equal(result.consecutiveMissCount, 1);
    assert.equal(result.firstMissingAt.getTime(), T0.getTime());
    assert.equal(result.shouldClose, false);
  });

  it("enough consecutive misses but NOT enough elapsed time: stays open", () => {
    // 3rd consecutive miss, but only 1 minute after the first: fast-polling
    // source racking up misses quickly must not close prematurely.
    const now = minutesAfter(T0, 1);
    const result = evaluateMissedJob({ consecutiveMissCount: CLOSURE_MISS_THRESHOLD - 1, firstMissingAt: T0 }, now);
    assert.equal(result.consecutiveMissCount, CLOSURE_MISS_THRESHOLD);
    assert.equal(result.shouldClose, false, "time floor must block closure even with enough misses");
  });

  it("enough elapsed time but NOT enough consecutive misses: stays open", () => {
    // Only the 2nd miss, even though it's well past the time floor.
    const now = minutesAfter(T0, 60);
    const result = evaluateMissedJob({ consecutiveMissCount: 1, firstMissingAt: T0 }, now);
    assert.equal(result.consecutiveMissCount, 2);
    assert.ok(result.consecutiveMissCount < CLOSURE_MISS_THRESHOLD);
    assert.equal(result.shouldClose, false, "miss-count floor must block closure even with plenty of elapsed time");
  });

  it("closes only once BOTH thresholds are met on the same evaluation", () => {
    const now = minutesAfter(T0, CLOSURE_MIN_MISSING_MS / 60_000);
    const result = evaluateMissedJob({ consecutiveMissCount: CLOSURE_MISS_THRESHOLD - 1, firstMissingAt: T0 }, now);
    assert.equal(result.consecutiveMissCount, CLOSURE_MISS_THRESHOLD);
    assert.equal(result.shouldClose, true);
  });

  it("firstMissingAt is set on the first miss and preserved (not reset) on subsequent misses", () => {
    const first = evaluateMissedJob({ consecutiveMissCount: 0, firstMissingAt: null }, T0);
    const second = evaluateMissedJob(
      { consecutiveMissCount: first.consecutiveMissCount, firstMissingAt: first.firstMissingAt },
      minutesAfter(T0, 5),
    );
    assert.equal(second.firstMissingAt.getTime(), T0.getTime(), "the run's start time must not slide forward");
  });
});

describe("isCircuitBreakerTripped", () => {
  it("does not trip below the minimum sample size, even at 100% missing", () => {
    assert.equal(isCircuitBreakerTripped(CIRCUIT_BREAKER_MIN_SAMPLE - 1, CIRCUIT_BREAKER_MIN_SAMPLE - 1), false);
  });

  it("does not trip just under the fraction threshold at a valid sample size", () => {
    const active = 10;
    const missing = Math.ceil(active * CIRCUIT_BREAKER_FRACTION) - 1;
    assert.equal(isCircuitBreakerTripped(active, missing), false);
  });

  it("trips at or above the fraction threshold with a valid sample size", () => {
    const active = 10;
    const missing = Math.ceil(active * CIRCUIT_BREAKER_FRACTION);
    assert.equal(isCircuitBreakerTripped(active, missing), true);
  });

  it("does not trip on zero active jobs (nothing to compare against)", () => {
    assert.equal(isCircuitBreakerTripped(0, 0), false);
  });
});
