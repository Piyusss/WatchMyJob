import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backoffDelayMs } from "./backoff.js";

describe("backoffDelayMs", () => {
  it("doubles each attempt", () => {
    const first = backoffDelayMs(1);
    const second = backoffDelayMs(2);
    const third = backoffDelayMs(3);
    assert.equal(second, first * 2);
    assert.equal(third, first * 4);
  });

  it("is capped, not unbounded", () => {
    // Doubling from a small base reaches a 30-minute-scale cap well before
    // attempt 10 -- MAX_SEND_ATTEMPTS itself (5) is too low for the cap to
    // matter in practice today; this checks the safety bound exists
    // independent of that, e.g. for whenever it's raised later.
    const atCeiling = backoffDelayMs(10);
    const wayPast = backoffDelayMs(20);
    assert.equal(wayPast, atCeiling, "delay must plateau, not keep doubling forever");
  });

  it("is always positive and in milliseconds (not accidentally seconds/minutes)", () => {
    const delay = backoffDelayMs(1);
    assert.ok(delay >= 60_000, "even the first retry should wait at least a minute, not near-instantly");
  });
});
