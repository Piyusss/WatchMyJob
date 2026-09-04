import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePreSendCheck, type PreSendCheckInput } from "./preSendCheck.js";

function input(overrides: Partial<PreSendCheckInput> = {}): PreSendCheckInput {
  return {
    jobStatus: "ACTIVE",
    companyStatus: "ACTIVE",
    subscriptionActive: true,
    userEmailVerified: true,
    userNotificationsPaused: false,
    userEmailHardBounced: false,
    ...overrides,
  };
}

describe("evaluatePreSendCheck", () => {
  it("passes when everything is still valid", () => {
    assert.deepEqual(evaluatePreSendCheck(input()), { ok: true });
  });

  it("Section 28's own example: blocks a job that closed while queued", () => {
    const result = evaluatePreSendCheck(input({ jobStatus: "CLOSED" }));
    assert.equal(result.ok, false);
  });

  it("blocks when the company was deactivated after this notification was queued", () => {
    const result = evaluatePreSendCheck(input({ companyStatus: "INACTIVE" }));
    assert.equal(result.ok, false);
  });

  it("blocks when the user unsubscribed from the company after queueing", () => {
    const result = evaluatePreSendCheck(input({ subscriptionActive: false }));
    assert.equal(result.ok, false);
  });

  it("blocks an unverified email -- Critical Issue #11's fix", () => {
    const result = evaluatePreSendCheck(input({ userEmailVerified: false }));
    assert.equal(result.ok, false);
  });

  it("blocks when the user paused notifications after queueing", () => {
    const result = evaluatePreSendCheck(input({ userNotificationsPaused: true }));
    assert.equal(result.ok, false);
  });

  it("blocks an email address that permanently bounced", () => {
    const result = evaluatePreSendCheck(input({ userEmailHardBounced: true }));
    assert.equal(result.ok, false);
  });

  it("each condition is checked independently -- multiple failures don't cancel out", () => {
    const result = evaluatePreSendCheck(input({ jobStatus: "CLOSED", userNotificationsPaused: true }));
    assert.equal(result.ok, false);
  });
});
