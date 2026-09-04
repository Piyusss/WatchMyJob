import type { OpportunityType, WorkMode } from "@prisma/client";

export interface MatchableJob {
  status: "ACTIVE" | "CLOSED";
  roleFamily: string | null;
  level: string | null;
  location: string | null;
  workMode: WorkMode | null;
  opportunityType: OpportunityType;
  experienceStatus: "KNOWN" | "UNKNOWN";
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
}

export interface MatchableLocation {
  countryName: string;
  stateName: string | null;
  cityName: string | null;
}

export interface MatchablePreferences {
  roleFamily: string | null;
  roleLevel: string | null;
  yearsExperience: number | null;
  toleranceYears: number | null;
  locations: MatchableLocation[];
  workMode: WorkMode[];
  opportunityTypes: OpportunityType[];
}

// Extraction failure is vanishingly rare (0/208 in the real dataset behind
// Phase 8 -- role_family always has at least the raw title to fall back
// to), so unlike level/location/workMode below, a null job.roleFamily
// fails the dimension rather than passing by default: there's no "unknown"
// state built for this field the way there is for experience, and treating
// a near-impossible case as "unknown, don't block" isn't worth the risk of
// hiding a genuine mismatch.
function matchRoleFamily(jobRoleFamily: string | null, prefRoleFamily: string | null): boolean {
  const pref = prefRoleFamily?.trim();
  if (!pref) return true;
  if (!jobRoleFamily) return false;
  // Prefix match, not equality: Phase 8 deliberately doesn't normalize
  // "Software Engineer, Ads" / "Software Engineer - AI Platforms" down to
  // a canonical "Software Engineer" (no real synonym table was built --
  // see classify.ts). A user typing "Software Engineer" should still match
  // every specialization of it.
  return jobRoleFamily.toLowerCase().startsWith(pref.toLowerCase());
}

// Most real jobs (169/208 in the same dataset) have no extracted level at
// all -- "Manager, X" / "Director, X" titles are deliberately left
// unparsed by Phase 8's classifier rather than guessed. A null level here
// therefore passes by default, the same "missing data never causes a
// silent exclusion" principle Section 18 states for experience.
function matchLevel(jobLevel: string | null, prefRoleLevel: string | null): boolean {
  const pref = prefRoleLevel?.trim();
  if (!pref) return true;
  if (!jobLevel) return true;
  return jobLevel.toLowerCase() === pref.toLowerCase();
}

// Within ONE location, city/state/country name one hierarchy, not three
// separate filters -- a user who picked a city wants that city specifically,
// not "anywhere matching city, state, OR country" (too loose) and not "must
// match all three simultaneously" (too strict). The most specific level the
// user picked is the one that governs.
function locationTerm(loc: MatchableLocation): string {
  return loc.cityName || loc.stateName || loc.countryName;
}

// Across MULTIPLE locations, the relationship flips to OR: a user who added
// both Pune and Bangalore wants either, never both at once (a single job
// posting only ever names one place). No locations selected means no
// filter, same as the old single-location "all three blank" case.
function matchLocation(jobLocation: string | null, locations: MatchableLocation[]): boolean {
  if (locations.length === 0) return true;
  if (!jobLocation) return true; // no location signal from the source -- don't block on it
  const haystack = jobLocation.toLowerCase();
  return locations.some((loc) => haystack.includes(locationTerm(loc).toLowerCase()));
}

function matchWorkMode(jobWorkMode: WorkMode | null, prefWorkModes: WorkMode[]): boolean {
  if (prefWorkModes.length === 0) return true;
  if (!jobWorkMode) return true; // best-effort inference (Phase 4) often can't tell -- don't block on it
  return prefWorkModes.includes(jobWorkMode);
}

// Unlike the other dimensions, an EMPTY selection here does not mean "no
// filter" -- it defaults to FULL_TIME only. This is the categorical gate
// Section 17 exists for: a user who simply hasn't configured this
// preference yet must never be surprised by an internship (or a contract
// role) landing in their matches. Reaching every opportunity type requires
// explicitly selecting it, mirroring the README's own worked example
// ("Internships = YES, Full-time = YES" -- both stated, neither implied).
function matchOpportunityType(jobType: OpportunityType, prefTypes: OpportunityType[]): boolean {
  const effective = prefTypes.length > 0 ? prefTypes : (["FULL_TIME"] as OpportunityType[]);
  return effective.includes(jobType);
}

// The one dimension with a real, deliberately asymmetric rule: an
// open-ended requirement ("5+ years", the dominant real pattern per
// Phase 8) is NOT treated as unbounded just because the user's tolerance
// window reaches the floor. Critical Issue #8: a 10-year candidate with
// +-1 tolerance would otherwise match any "3+ years" posting regardless of
// how senior it actually targets. The role-level co-gate only activates
// when the user has actually stated a level preference -- someone who
// hasn't is not protected against (nor blocked by) it.
function matchExperience(job: MatchableJob, prefs: MatchablePreferences): boolean {
  if (job.experienceStatus === "UNKNOWN") return true;
  if (prefs.yearsExperience === null) return true;

  const tolerance = prefs.toleranceYears ?? 0;
  const userMin = prefs.yearsExperience - tolerance;
  const userMax = prefs.yearsExperience + tolerance;
  const requiredMin = job.requiredExperienceMin ?? 0;
  const requiredMax = job.requiredExperienceMax;

  if (requiredMax !== null) {
    return userMax >= requiredMin && userMin <= requiredMax;
  }

  const prefLevel = prefs.roleLevel?.trim();
  if (prefLevel) {
    if (!job.level) return false;
    if (job.level.toLowerCase() !== prefLevel.toLowerCase()) return false;
  }
  return userMax >= requiredMin;
}

export interface MatchExplanation {
  roleMatched: boolean;
  levelMatched: boolean;
  experienceMatched: boolean;
  locationMatched: boolean;
  workModeMatched: boolean;
  opportunityTypeMatched: boolean;
  // Includes the job.status === "ACTIVE" gate, which has no single
  // corresponding UI criterion (a closed job isn't "not a location match,"
  // it's simply not shown) -- callers that want the per-criterion booleans
  // for a "why this matches" UI should ignore this dimension entirely and
  // read the individual fields, which are computed the same regardless of
  // status.
  overallMatch: boolean;
}

// The single canonical per-criterion evaluation -- both matchesPreferences
// (the notification-eligibility gate) and the job-detail endpoint's "why
// this matches" data (see jobs/routes.ts) call this SAME function, so the
// two can never silently drift apart into two different definitions of
// "matches."
export function getMatchExplanation(job: MatchableJob, prefs: MatchablePreferences): MatchExplanation {
  const roleMatched = matchRoleFamily(job.roleFamily, prefs.roleFamily);
  const levelMatched = matchLevel(job.level, prefs.roleLevel);
  const locationMatched = matchLocation(job.location, prefs.locations);
  const workModeMatched = matchWorkMode(job.workMode, prefs.workMode);
  const opportunityTypeMatched = matchOpportunityType(job.opportunityType, prefs.opportunityTypes);
  const experienceMatched = matchExperience(job, prefs);

  return {
    roleMatched,
    levelMatched,
    experienceMatched,
    locationMatched,
    workModeMatched,
    opportunityTypeMatched,
    overallMatch:
      job.status === "ACTIVE" &&
      roleMatched &&
      levelMatched &&
      locationMatched &&
      workModeMatched &&
      opportunityTypeMatched &&
      experienceMatched,
  };
}

// The full dimension gate (blueprint condition 3). Timing (condition 4),
// idempotency (condition 5), and the send-time recheck (condition 6) are
// deliberately NOT here -- see eligibility.ts and, for the send-time
// recheck, Phase 10's notification worker.
export function matchesPreferences(job: MatchableJob, prefs: MatchablePreferences): boolean {
  return getMatchExplanation(job, prefs).overallMatch;
}
