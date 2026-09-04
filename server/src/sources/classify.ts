import type { ExperienceStatus, OpportunityType } from "@prisma/client";
import type { NormalizedJob } from "./types.js";
import { htmlToText } from "./htmlText.js";

export interface JobClassification {
  roleFamily: string | null;
  level: string | null;
  opportunityType: OpportunityType;
  experienceStatus: ExperienceStatus;
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
  preferredExperienceMin: number | null;
  preferredExperienceMax: number | null;
}

// ---- Opportunity type: title only. A title's ABSENCE of "intern" /
// "contract" / "part-time" language is itself a reliable full-time signal
// (standard job-board convention) -- unlike experience, this default is
// earned, not invented. The description isn't scanned: "contract" shows up
// in ordinary full-time postings too (e.g. "negotiating contracts"),
// making the title the only high-confidence source for this signal.
function classifyOpportunityType(title: string): OpportunityType {
  if (/\bintern(ship)?\b/i.test(title)) return "INTERNSHIP";
  if (/\bcontract(or)?\b/i.test(title)) return "CONTRACT";
  if (/\bpart[\s-]?time\b/i.test(title)) return "PART_TIME";
  return "FULL_TIME";
}

// ---- Level + role family -----------------------------------------------
// Grounded in two real employers' live titles (see git history / phase
// notes): every seniority word observed appears as a PREFIX ("Senior
// Software Engineer", "Staff Data Engineer"), never a suffix, so only
// prefix position is trusted for these. "Lead" is included on well-established
// industry convention despite not appearing in that sample; anything not
// in this list (Manager, Director, Head of, VP) is deliberately left
// unparsed -- those routinely name the role itself on a management track
// ("Director, Business Operations"), not a modifier on some other base
// role, and guessing which case applies would be exactly the kind of
// invented structure Section 18 forbids for experience.
const LEVEL_PREFIXES = [
  "Entry Level",
  "Entry-Level",
  "Principal",
  "Associate",
  "Senior",
  "Junior",
  "Staff",
  "Lead",
  "Sr.",
  "Jr.",
  "Sr",
  "Jr",
].sort((a, b) => b.length - a.length); // longest first so "Entry Level" wins over any shorter overlapping prefix

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanRoleFamily(text: string): string | null {
  const cleaned = text
    .replace(/^[,\-–—\s]+/, "")
    .replace(/[,\-–—\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

// A bare Roman numeral or digit 1-5 at the ABSOLUTE end of the title, per
// the canonical "Software Engineer I" / "SDE 1" example -- deliberately
// not extended to tolerate a trailing parenthetical (no real example
// justifies that complexity; failing to extract is safer than guessing).
const NUMBERED_LEVEL_SUFFIX = /\s+(I{1,3}|IV|V|[1-5])$/;
const INTERN_WORD = /\b(internship|intern)\b/i;

export function classifyLevelAndRoleFamily(rawTitle: string): { roleFamily: string | null; level: string | null } {
  const title = rawTitle.trim();
  if (!title) return { roleFamily: null, level: null };

  for (const prefix of LEVEL_PREFIXES) {
    const match = title.match(new RegExp(`^${escapeRegExp(prefix)}\\b\\s+`, "i"));
    if (match) {
      return { roleFamily: cleanRoleFamily(title.slice(match[0].length)), level: prefix.replace(/\.$/, "") };
    }
  }

  const internMatch = title.match(INTERN_WORD);
  if (internMatch) {
    return { roleFamily: cleanRoleFamily(title.replace(INTERN_WORD, "")), level: "Intern" };
  }

  const numberedMatch = title.match(NUMBERED_LEVEL_SUFFIX);
  if (numberedMatch) {
    return { roleFamily: cleanRoleFamily(title.slice(0, numberedMatch.index)), level: numberedMatch[1] };
  }

  return { roleFamily: cleanRoleFamily(title), level: null };
}

// ---- Experience ----------------------------------------------------------
// Grounded in real descriptions from two live Greenhouse boards: the
// dominant pattern by far is an open-ended floor ("5+ years of
// experience"), with an explicit "N-M years" range appearing only rarely.
// A required-vs-preferred split is real "5+ years required... nice to have
// experience with X" -- section markers really do appear in practice) but
// unvalidated against a positive real example in this dataset; it degrades
// safely (marker never found -> everything is "required text", matching
// Section 16's default when no distinction is stated).
const PREFERRED_SECTION_MARKER =
  /(nice[- ]to[- ]have|preferred qualifications?|preferred:|bonus points?|a plus if|it'?s a plus|not required(?: but)?)/i;

const YEARS_PATTERN = /(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\+?\s*years?\b|(\d{1,2})\+?\s*years?\b/i;

function extractYears(text: string): { min: number; max: number | null } | null {
  const match = text.match(YEARS_PATTERN);
  if (!match) return null;
  if (match[1] !== undefined && match[2] !== undefined) {
    return { min: Number(match[1]), max: Number(match[2]) };
  }
  if (match[3] !== undefined) {
    return { min: Number(match[3]), max: null };
  }
  return null;
}

function classifyExperience(descriptionText: string) {
  const markerMatch = descriptionText.match(PREFERRED_SECTION_MARKER);
  const requiredText = markerMatch ? descriptionText.slice(0, markerMatch.index) : descriptionText;
  const preferredText = markerMatch ? descriptionText.slice(markerMatch.index!) : "";

  const required = extractYears(requiredText);
  const preferred = preferredText ? extractYears(preferredText) : null;

  if (!required && !preferred) {
    return {
      status: "UNKNOWN" as const,
      requiredMin: null,
      requiredMax: null,
      preferredMin: null,
      preferredMax: null,
    };
  }

  return {
    status: "KNOWN" as const,
    requiredMin: required?.min ?? null,
    requiredMax: required?.max ?? null,
    preferredMin: preferred?.min ?? null,
    preferredMax: preferred?.max ?? null,
  };
}

// Pure function of title + description -- no I/O, directly testable, and
// deliberately re-run only when contentHash changes (see sync.ts): the same
// title+description always classifies the same way. Takes only the two
// fields it actually reads (not the full NormalizedJob) so callers with a
// differently-shaped record -- e.g. admin/reclassify.ts backfilling from
// already-stored Job rows -- don't need to fake the rest of the interface.
export function classifyJob(
  job: Pick<NormalizedJob, "title" | "description"> & Partial<Pick<NormalizedJob, "opportunityTypeHint">>,
): JobClassification {
  const { roleFamily, level } = classifyLevelAndRoleFamily(job.title);
  // A source-supplied structured signal (Lever's commitment field) beats
  // title parsing when available -- see NormalizedJob.opportunityTypeHint.
  const opportunityType = job.opportunityTypeHint ?? classifyOpportunityType(job.title);
  const experience = classifyExperience(htmlToText(job.description));

  return {
    roleFamily,
    level,
    opportunityType,
    experienceStatus: experience.status,
    requiredExperienceMin: experience.requiredMin,
    requiredExperienceMax: experience.requiredMax,
    preferredExperienceMin: experience.preferredMin,
    preferredExperienceMax: experience.preferredMax,
  };
}
