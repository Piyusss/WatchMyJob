import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateEligibility } from "./eligibility.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");
function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

describe("evaluateEligibility", () => {
  it("job first seen at or after the cutoff: NEW_JOB", () => {
    const result = evaluateEligibility({
      jobFirstSeenAt: T0,
      jobLastMatchRelevantChangeAt: null,
      subscribedAt: daysAfter(T0, -1),
      preferencesEffectiveSince: daysAfter(T0, -5),
    });
    assert.equal(result, "NEW_JOB");
  });

  it("the core onboarding rule: job existed before the subscription, no later change -- must not notify", () => {
    const result = evaluateEligibility({
      jobFirstSeenAt: T0,
      jobLastMatchRelevantChangeAt: null,
      subscribedAt: daysAfter(T0, 1),
      preferencesEffectiveSince: daysAfter(T0, -5),
    });
    assert.equal(result, null);
  });

  it("job predates the subscription, but a matching-relevant change happened after it: MATCH_VIA_UPDATE", () => {
    // Critical Issue #6's exact scenario: job existed before subscription,
    // later corrected to newly match.
    const result = evaluateEligibility({
      jobFirstSeenAt: T0,
      jobLastMatchRelevantChangeAt: daysAfter(T0, 10),
      subscribedAt: daysAfter(T0, 1),
      preferencesEffectiveSince: daysAfter(T0, -5),
    });
    assert.equal(result, "MATCH_VIA_UPDATE");
  });

  it("job predates the subscription, and the change ALSO predates it: no notification", () => {
    const result = evaluateEligibility({
      jobFirstSeenAt: T0,
      jobLastMatchRelevantChangeAt: daysAfter(T0, 0.5),
      subscribedAt: daysAfter(T0, 1),
      preferencesEffectiveSince: daysAfter(T0, -5),
    });
    assert.equal(result, null);
  });

  it("cutoff is the LATER of subscribedAt and preferencesEffectiveSince -- a preference widen re-gates an old subscription", () => {
    // User subscribed long ago (would trivially pass on subscription alone)
    // but just widened their preferences -- the widen's timestamp must
    // govern, per the preference-widening flood fix.
    const result = evaluateEligibility({
      jobFirstSeenAt: daysAfter(T0, 2), // job existed before the preference widen
      jobLastMatchRelevantChangeAt: null,
      subscribedAt: daysAfter(T0, -30), // subscribed a month before T0
      preferencesEffectiveSince: daysAfter(T0, 5), // widened preferences well after the job appeared
    });
    assert.equal(result, null, "a job that predates the preference widen must not flood the user just because the old subscription is ancient");
  });

  it("a job created after the preference widen still correctly notifies", () => {
    const result = evaluateEligibility({
      jobFirstSeenAt: daysAfter(T0, 10),
      jobLastMatchRelevantChangeAt: null,
      subscribedAt: daysAfter(T0, -30),
      preferencesEffectiveSince: daysAfter(T0, 5),
    });
    assert.equal(result, "NEW_JOB");
  });
});
