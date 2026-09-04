import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyJob, classifyLevelAndRoleFamily } from "./classify.js";
import type { NormalizedJob } from "./types.js";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalJobId: "1",
    title: "Software Engineer",
    location: null,
    workMode: null,
    description: null,
    sourceUrl: "https://example.test/1",
    postedAt: null,
    ...overrides,
  };
}

// Real titles observed on live Figma/Discord Greenhouse boards, used
// verbatim -- these are the actual cases the extractor has to survive, not
// hypothetical ones.
describe("classifyLevelAndRoleFamily -- real observed titles", () => {
  const cases: [string, string | null, string][] = [
    ["Senior Software Engineer, Ads", "Senior", "Software Engineer, Ads"],
    ["Staff Data Engineer - Data Infrastructure", "Staff", "Data Engineer - Data Infrastructure"],
    ["Associate Product Counsel, Safety", "Associate", "Product Counsel, Safety"],
    ["Software Engineer Intern (Winter 2027)", "Intern", "Software Engineer (Winter 2027)"],
    ["Senior Accountant", "Senior", "Accountant"],
    // No recognized modifier -- "Manager"/"Director" are deliberately left
    // unparsed (see classify.ts's comment): they routinely name the role
    // itself on a management track, not a level on some other base role.
    ["Manager, Customer Enablement (Tokyo, Japan)", null, "Manager, Customer Enablement (Tokyo, Japan)"],
    ["Director of Engineering, Safety", null, "Director of Engineering, Safety"],
    ["Engineering Manager, Machine Learning (Safety)", null, "Engineering Manager, Machine Learning (Safety)"],
    // Trailing location parentheticals are deliberately NOT stripped (real
    // data has no reliable way to distinguish "(Berlin, Germany)" from
    // "(Winter 2027)" or "(2026)" without a location dictionary this
    // project doesn't have -- see classify.ts's comment on this call).
    ["Account Executive, Enterprise (Berlin, Germany)", null, "Account Executive, Enterprise (Berlin, Germany)"],
  ];

  for (const [title, expectedLevel, expectedRoleFamily] of cases) {
    it(`"${title}"`, () => {
      const result = classifyLevelAndRoleFamily(title);
      assert.equal(result.level, expectedLevel);
      assert.equal(result.roleFamily, expectedRoleFamily);
    });
  }
});

describe("classifyLevelAndRoleFamily -- the README's own canonical example", () => {
  it("a numbered level at the absolute end of the title is extracted", () => {
    const result = classifyLevelAndRoleFamily("Software Engineer I");
    assert.equal(result.level, "I");
    assert.equal(result.roleFamily, "Software Engineer");
  });

  it("a numbered level followed by anything else is NOT extracted -- honest under-extraction over a fragile guess", () => {
    const result = classifyLevelAndRoleFamily("Software Engineer I (Remote)");
    assert.equal(result.level, null);
  });
});

describe("classifyJob -- opportunity type", () => {
  it("classifies the one real internship in the dataset correctly", () => {
    const c = classifyJob(job({ title: "Software Engineer Intern (Winter 2027)" }));
    assert.equal(c.opportunityType, "INTERNSHIP");
  });

  it("defaults to FULL_TIME for an ordinary title with no signal", () => {
    const c = classifyJob(job({ title: "Senior Software Engineer, Ads" }));
    assert.equal(c.opportunityType, "FULL_TIME");
  });

  it("a real Figma title containing 'Internal' must NOT be misclassified as an internship", () => {
    // Discovered while building Phase 12's fixture data: "internal" fails
    // a naive /intern/i.test() but must also fail classify.ts's real
    // \bintern\b word-boundary regex, which it does -- "al" continues the
    // word, so there's no boundary after "intern".
    const c = classifyJob(job({ title: "IT Engineer, Internal AI Infrastructure" }));
    assert.equal(c.opportunityType, "FULL_TIME");
  });

  it("a real Lever structured hint (opportunityTypeHint) is preferred over title parsing", () => {
    const c = classifyJob(job({ title: "Deployment Strategist, Internship", opportunityTypeHint: "INTERNSHIP" }));
    assert.equal(c.opportunityType, "INTERNSHIP");
  });

  it("a hint of null falls back to title-based classification, not a forced default", () => {
    const c = classifyJob(job({ title: "Software Engineer Intern (Winter 2027)", opportunityTypeHint: null }));
    assert.equal(c.opportunityType, "INTERNSHIP", "title parsing should still catch it when the hint is absent");
  });

  it("detects contract and part-time from the title", () => {
    assert.equal(classifyJob(job({ title: "Software Engineer (Contract)" })).opportunityType, "CONTRACT");
    assert.equal(classifyJob(job({ title: "Support Specialist, Part-Time" })).opportunityType, "PART_TIME");
  });
});

describe("classifyJob -- experience extraction against real description text", () => {
  it("no year-count mention anywhere: UNKNOWN, not a guessed zero", () => {
    const c = classifyJob(
      job({
        description:
          "&lt;p&gt;We are looking for a designer to join our growing team and help shape the future of our product.&lt;/p&gt;",
      }),
    );
    assert.equal(c.experienceStatus, "UNKNOWN");
    assert.equal(c.requiredExperienceMin, null);
    assert.equal(c.requiredExperienceMax, null);
  });

  it("the dominant real pattern -- open-ended floor, e.g. '5+ years of experience'", () => {
    // Verbatim structure from a real Figma posting (Software Engineer, Data Platform).
    const c = classifyJob(
      job({
        description:
          "&lt;h4&gt;What you should have&lt;/h4&gt;&lt;ul&gt;&lt;li&gt;3+ years of software engineering experience&lt;/li&gt;&lt;/ul&gt;",
      }),
    );
    assert.equal(c.experienceStatus, "KNOWN");
    assert.equal(c.requiredExperienceMin, 3);
    assert.equal(c.requiredExperienceMax, null, "an open floor must not invent a ceiling");
  });

  it("an explicit range -- real but rare in the dataset, e.g. '1-3 years'", () => {
    // Verbatim from a real Discord posting (Software Engineer, Developer Success).
    const c = classifyJob(job({ description: "&lt;li&gt;At least 1-3 years experience as a software engineer&lt;/li&gt;" }));
    assert.equal(c.experienceStatus, "KNOWN");
    assert.equal(c.requiredExperienceMin, 1);
    assert.equal(c.requiredExperienceMax, 3);
  });

  it("takes the FIRST year mention when a description states several for different sub-skills", () => {
    // A real Discord posting (Director of Engineering, Safety) states
    // "5+ years as a software engineer... 5+ years as an EM including 2+
    // years managing managers" -- multiple legitimate but different
    // numbers. Documented, deliberate policy: take the first, don't guess
    // which one is "the" requirement.
    const c = classifyJob(
      job({
        description:
          "&lt;li&gt;5+ years as a software engineer with a strong backend background&lt;/li&gt;" +
          "&lt;li&gt;5+ years as an EM including 2+ years managing managers&lt;/li&gt;",
      }),
    );
    assert.equal(c.requiredExperienceMin, 5);
  });

  it("a 'nice to have' section after the required one is attributed to preferred, not required", () => {
    // Synthetic -- no positive real example of this pattern exists in the
    // current two-employer dataset (documented in classify.ts), but the
    // structural marker this relies on (an h4-style section header) is
    // real and observed for other section types on the same boards.
    const c = classifyJob(
      job({
        description:
          "&lt;h4&gt;What you should have&lt;/h4&gt;&lt;li&gt;3+ years of experience&lt;/li&gt;" +
          "&lt;h4&gt;Nice to have&lt;/h4&gt;&lt;li&gt;5+ years of experience with distributed systems&lt;/li&gt;",
      }),
    );
    assert.equal(c.requiredExperienceMin, 3, "must not collapse required+preferred into one number");
    assert.equal(c.preferredExperienceMin, 5);
  });

  it("never fabricates a requirement for an internship with no stated experience", () => {
    const c = classifyJob(
      job({
        title: "Software Engineer Intern (Winter 2027)",
        description: "&lt;p&gt;Currently pursuing a degree in Computer Science or a related field.&lt;/p&gt;",
      }),
    );
    assert.equal(c.experienceStatus, "UNKNOWN", "opportunity type gates internships -- experience must not guess 0");
  });
});
