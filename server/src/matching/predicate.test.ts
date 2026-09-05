import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMatchExplanation,
  matchesPreferences,
  type MatchableJob,
  type MatchableLocation,
  type MatchablePreferences,
} from "./predicate.js";

function loc(overrides: Partial<MatchableLocation> = {}): MatchableLocation {
  return { countryName: "India", stateName: null, cityName: null, ...overrides };
}

function job(overrides: Partial<MatchableJob> = {}): MatchableJob {
  return {
    status: "ACTIVE",
    roleFamily: "Software Engineer",
    level: null,
    location: null,
    workMode: null,
    opportunityType: "FULL_TIME",
    experienceStatus: "UNKNOWN",
    requiredExperienceMin: null,
    requiredExperienceMax: null,
    ...overrides,
  };
}

function prefs(overrides: Partial<MatchablePreferences> = {}): MatchablePreferences {
  return {
    roleFamily: null,
    roleLevel: null,
    yearsExperience: null,
    toleranceYears: null,
    locations: [],
    workMode: [],
    opportunityTypes: [],
    ...overrides,
  };
}

describe("matchesPreferences: status gate", () => {
  it("a CLOSED job never matches, regardless of everything else", () => {
    assert.equal(matchesPreferences(job({ status: "CLOSED" }), prefs()), false);
  });
});

describe("matchesPreferences: role family (prefix match, per Phase 8's un-normalized extraction)", () => {
  it("no preference set: passes regardless of job value", () => {
    assert.equal(matchesPreferences(job({ roleFamily: null }), prefs({ roleFamily: "" })), true);
  });

  it("user's role family is a prefix of the job's more specific one", () => {
    assert.equal(
      matchesPreferences(job({ roleFamily: "Software Engineer, Ads" }), prefs({ roleFamily: "Software Engineer" })),
      true,
    );
  });

  it("case-insensitive", () => {
    assert.equal(matchesPreferences(job({ roleFamily: "software engineer" }), prefs({ roleFamily: "Software Engineer" })), true);
  });

  it("a genuinely different role family does not match", () => {
    assert.equal(matchesPreferences(job({ roleFamily: "Product Manager" }), prefs({ roleFamily: "Software Engineer" })), false);
  });

  it("a null job roleFamily fails when the user has a preference: no UNKNOWN state exists for this field", () => {
    assert.equal(matchesPreferences(job({ roleFamily: null }), prefs({ roleFamily: "Software Engineer" })), false);
  });
});

describe("matchesPreferences: level (unknown passes by default: most real jobs have none)", () => {
  it("job.level is null: passes even though the user asked for a specific level", () => {
    assert.equal(matchesPreferences(job({ level: null }), prefs({ roleLevel: "Senior" })), true);
  });

  it("matching level, case-insensitive", () => {
    assert.equal(matchesPreferences(job({ level: "senior" }), prefs({ roleLevel: "Senior" })), true);
  });

  it("mismatched stated level fails", () => {
    assert.equal(matchesPreferences(job({ level: "Staff" }), prefs({ roleLevel: "Senior" })), false);
  });
});

describe("matchesPreferences: location (within one location, most specific field wins: city > state > country)", () => {
  it("no locations added at all: passes", () => {
    assert.equal(matchesPreferences(job({ location: "Paris, France" }), prefs()), true);
  });

  it("city set: matches on city substring, ignores state/country mismatches", () => {
    assert.equal(
      matchesPreferences(
        job({ location: "Bangalore, India" }),
        prefs({ locations: [loc({ cityName: "Bangalore", stateName: "Nonexistent State", countryName: "Nonexistent Country" })] }),
      ),
      true,
    );
  });

  it("city set but absent from the job's location string: fails", () => {
    assert.equal(
      matchesPreferences(job({ location: "Berlin, Germany" }), prefs({ locations: [loc({ cityName: "Bangalore" })] })),
      false,
    );
  });

  it("falls back to country when city/state are blank", () => {
    assert.equal(
      matchesPreferences(job({ location: "Berlin, Germany" }), prefs({ locations: [loc({ countryName: "Germany" })] })),
      true,
    );
  });

  it("null job location passes: no signal to filter on", () => {
    assert.equal(
      matchesPreferences(job({ location: null }), prefs({ locations: [loc({ cityName: "Bangalore" })] })),
      true,
    );
  });
});

describe("matchesPreferences: location (multiple locations are OR, never AND)", () => {
  it("job matches the second of two added locations: passes", () => {
    assert.equal(
      matchesPreferences(
        job({ location: "Pune, India" }),
        prefs({
          locations: [loc({ cityName: "Bangalore" }), loc({ cityName: "Pune" })],
        }),
      ),
      true,
    );
  });

  it("job matches neither of two added locations: fails", () => {
    assert.equal(
      matchesPreferences(
        job({ location: "Berlin, Germany" }),
        prefs({
          locations: [loc({ cityName: "Bangalore" }), loc({ cityName: "Pune" })],
        }),
      ),
      false,
    );
  });

  it("removing one location does not affect matching against the other", () => {
    const twoLocations = prefs({ locations: [loc({ cityName: "Bangalore" }), loc({ cityName: "Pune" })] });
    const oneLocationRemoved = prefs({ locations: [loc({ cityName: "Pune" })] });
    const job1 = job({ location: "Pune, India" });
    assert.equal(matchesPreferences(job1, twoLocations), true);
    assert.equal(matchesPreferences(job1, oneLocationRemoved), true);
  });
});

describe("matchesPreferences: work mode", () => {
  it("empty preference array: passes any work mode", () => {
    assert.equal(matchesPreferences(job({ workMode: "ON_SITE" }), prefs({ workMode: [] })), true);
  });

  it("job's work mode is in the preferred set", () => {
    assert.equal(matchesPreferences(job({ workMode: "REMOTE" }), prefs({ workMode: ["REMOTE", "HYBRID"] })), true);
  });

  it("job's work mode is NOT in the preferred set", () => {
    assert.equal(matchesPreferences(job({ workMode: "ON_SITE" }), prefs({ workMode: ["REMOTE"] })), false);
  });

  it("null job work mode passes regardless of preference", () => {
    assert.equal(matchesPreferences(job({ workMode: null }), prefs({ workMode: ["REMOTE"] })), true);
  });
});

describe("matchesPreferences: opportunity type (the internship-overreach gate)", () => {
  it("empty preference defaults to FULL_TIME only: an internship must NOT leak through to an unconfigured user", () => {
    assert.equal(matchesPreferences(job({ opportunityType: "INTERNSHIP" }), prefs({ opportunityTypes: [] })), false);
  });

  it("empty preference still matches an ordinary FULL_TIME job", () => {
    assert.equal(matchesPreferences(job({ opportunityType: "FULL_TIME" }), prefs({ opportunityTypes: [] })), true);
  });

  it("explicitly selecting INTERNSHIP is required to match one: mirrors the README's own worked example", () => {
    assert.equal(
      matchesPreferences(job({ opportunityType: "INTERNSHIP" }), prefs({ opportunityTypes: ["INTERNSHIP"] })),
      true,
    );
  });

  it("selecting INTERNSHIP does not also silently allow CONTRACT", () => {
    assert.equal(matchesPreferences(job({ opportunityType: "CONTRACT" }), prefs({ opportunityTypes: ["INTERNSHIP"] })), false);
  });
});

describe("matchesPreferences: experience", () => {
  it("UNKNOWN status passes by default regardless of user preference (Section 18)", () => {
    assert.equal(
      matchesPreferences(job({ experienceStatus: "UNKNOWN" }), prefs({ yearsExperience: 2, toleranceYears: 0 })),
      true,
    );
  });

  it("no user experience preference set: passes any KNOWN requirement", () => {
    assert.equal(
      matchesPreferences(
        job({ experienceStatus: "KNOWN", requiredExperienceMin: 10, requiredExperienceMax: 15 }),
        prefs({ yearsExperience: null }),
      ),
      true,
    );
  });

  it("closed range: user's tolerance window overlaps [min, max]", () => {
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 1, requiredExperienceMax: 3 });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 2, toleranceYears: 1 })), true);
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 0, toleranceYears: 0 })), false, "README's own NO MATCH example: 0 vs 1-3");
  });

  it("closed range: an overqualified candidate outside the max still fails a bounded requirement", () => {
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 1, requiredExperienceMax: 3 });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 10, toleranceYears: 1 })), false);
  });

  it("Critical Issue #8: open-ended floor, NO role-level preference stated: plain floor check applies", () => {
    // "3+ years" with no max. A 10-year candidate with no stated level
    // preference has nothing for the co-gate to protect: the floor
    // check alone governs, and the floor is trivially satisfied.
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 3, requiredExperienceMax: null, level: null });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 10, toleranceYears: 1, roleLevel: null })), true);
  });

  it("Critical Issue #8: open-ended floor, role-level preference stated but job has no level: co-gate fails closed", () => {
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 3, requiredExperienceMax: null, level: null });
    assert.equal(
      matchesPreferences(j, prefs({ yearsExperience: 10, toleranceYears: 1, roleLevel: "SDE 1" })),
      false,
      "the exact failure scenario the fix targets: 10yr candidate must not sneak into an open-ended junior role",
    );
  });

  it("Critical Issue #8: open-ended floor, role-level preference stated and job's level actually matches: passes", () => {
    // A user honestly targeting the stated level (however senior) should
    // still match when the job's own level agrees.
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 3, requiredExperienceMax: null, level: "Staff" });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 10, toleranceYears: 1, roleLevel: "Staff" })), true);
  });

  it("Critical Issue #8: open-ended floor, role-level preference stated and job's level disagrees: fails", () => {
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 3, requiredExperienceMax: null, level: "Senior" });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 10, toleranceYears: 1, roleLevel: "Staff" })), false);
  });

  it("open-ended floor: a candidate below the floor still fails even with a matching level", () => {
    const j = job({ experienceStatus: "KNOWN", requiredExperienceMin: 5, requiredExperienceMax: null, level: "Senior" });
    assert.equal(matchesPreferences(j, prefs({ yearsExperience: 2, toleranceYears: 1, roleLevel: "Senior" })), false);
  });
});

describe("matchesPreferences: internship never satisfied by numeric overlap alone (Section 17)", () => {
  it("an internship with 0 required years and a fresher user with matching experience still needs the categorical gate", () => {
    const internship = job({
      opportunityType: "INTERNSHIP",
      experienceStatus: "KNOWN",
      requiredExperienceMin: 0,
      requiredExperienceMax: 1,
    });
    // Numeric range overlaps for a fresher, but opportunityTypes wasn't
    // explicitly opted in: must still fail on the categorical gate.
    assert.equal(matchesPreferences(internship, prefs({ yearsExperience: 0, toleranceYears: 0, opportunityTypes: [] })), false);
  });

  it("a senior candidate is excluded from an internship by the categorical gate even before experience is checked", () => {
    const internship = job({
      opportunityType: "INTERNSHIP",
      experienceStatus: "KNOWN",
      requiredExperienceMin: 0,
      requiredExperienceMax: 1,
    });
    assert.equal(
      matchesPreferences(internship, prefs({ yearsExperience: 10, toleranceYears: 1, opportunityTypes: ["INTERNSHIP"] })),
      false,
      "even opted in, a 10-year candidate's own experience window doesn't overlap a 0-1 year internship",
    );
  });
});

describe("getMatchExplanation: the canonical per-criterion breakdown", () => {
  it("every dimension true and ACTIVE status yields overallMatch true", () => {
    const explanation = getMatchExplanation(job(), prefs());
    assert.deepEqual(explanation, {
      roleMatched: true,
      levelMatched: true,
      experienceMatched: true,
      locationMatched: true,
      workModeMatched: true,
      opportunityTypeMatched: true,
      overallMatch: true,
    });
  });

  it("agrees with matchesPreferences on overallMatch: same underlying logic, not a second implementation", () => {
    const cases: [MatchableJob, MatchablePreferences][] = [
      [job({ roleFamily: "Data Scientist" }), prefs({ roleFamily: "Software Engineer" })],
      [job({ opportunityType: "INTERNSHIP" }), prefs()],
      [job({ status: "CLOSED" }), prefs()],
      [
        job({ experienceStatus: "KNOWN", requiredExperienceMin: 8 }),
        prefs({ yearsExperience: 1, toleranceYears: 0 }),
      ],
    ];
    for (const [j, p] of cases) {
      assert.equal(getMatchExplanation(j, p).overallMatch, matchesPreferences(j, p));
    }
  });

  it("isolates exactly one failing dimension without affecting the others: a real 'why this doesn't match' scenario", () => {
    const explanation = getMatchExplanation(
      job({ roleFamily: "Software Engineer", location: "Berlin, Germany" }),
      prefs({ roleFamily: "Software Engineer", locations: [loc({ cityName: "Bangalore" })] }),
    );
    assert.equal(explanation.roleMatched, true);
    assert.equal(explanation.locationMatched, false);
    assert.equal(explanation.levelMatched, true);
    assert.equal(explanation.workModeMatched, true);
    assert.equal(explanation.opportunityTypeMatched, true);
    assert.equal(explanation.overallMatch, false, "one failing dimension is enough to fail the overall match");
  });

  it("a CLOSED job can still have every per-criterion dimension true: overallMatch is what carries the status gate", () => {
    const explanation = getMatchExplanation(job({ status: "CLOSED" }), prefs());
    assert.equal(explanation.roleMatched, true);
    assert.equal(explanation.locationMatched, true);
    assert.equal(explanation.overallMatch, false, "CLOSED still fails overall despite every dimension passing");
  });
});
