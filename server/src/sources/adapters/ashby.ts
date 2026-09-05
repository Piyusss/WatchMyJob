import { validatePlatformConfig } from "../configSchemas.js";
import { fetchJson } from "../httpClient.js";
import { ashbyResponseSchema } from "../responseSchemas.js";
import type { DiscoveryResult, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";
import type { OpportunityType, WorkMode } from "@prisma/client";

// Ashby's public posting API: keyless, and the same "built to be embedded
// on the company's own careers page" basis as Greenhouse, Lever and
// SmartRecruiters, so it qualifies as OFFICIAL_API rather than a scrape.
//
// This is the platform that reaches the current generation of AI and
// developer-infrastructure employers, which the other adapters largely
// can't: OpenAI, Linear, Ramp, Supabase, Replit and Cohere were all
// verified live against it while building this.
function boardUrl(jobBoardName: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(jobBoardName)}`;
}

// Verified against the six live boards above (1,223 postings sampled):
// FullTime, Contract, Intern and Temporary were the values actually
// observed. PartTime is Ashby's documented fifth value and is mapped on
// that basis. Temporary gets OTHER rather than a guess at CONTRACT, the
// same call Lever's "Fixed-Term" gets in that adapter.
const EMPLOYMENT_TYPE_MAP: Record<string, OpportunityType> = {
  fulltime: "FULL_TIME",
  parttime: "PART_TIME",
  intern: "INTERNSHIP",
  contract: "CONTRACT",
  temporary: "OTHER",
};

const WORKPLACE_TYPE_MAP: Record<string, WorkMode> = {
  remote: "REMOTE",
  hybrid: "HYBRID",
  onsite: "ON_SITE",
};

function mapEmploymentType(value: string | null | undefined): OpportunityType | null {
  if (!value) return null;
  return EMPLOYMENT_TYPE_MAP[value.toLowerCase()] ?? null;
}

// workplaceType is the ONLY work-mode signal read here, for two separate
// reasons.
//
// The first is `isRemote`, a sibling boolean on every posting, and a trap:
// across the 1,223 sampled, isRemote was true for exactly 896 postings,
// which is precisely Hybrid (682) + Remote (214). It means "not strictly
// on-site", not "remote". Trusting it would relabel 682 hybrid roles as
// REMOTE, and workMode is a hard gate in matching/predicate.ts, so that
// would fire alerts for remote-only users about roles that require office
// days.
//
// The second is why there is no inferWorkMode(location) fallback when
// workplaceType is absent, which is what GreenhouseAdapter and
// WorkdayAdapter both do. Measured over 2,372 postings: 494 have no
// workplaceType, and only 20 of those have "remote" anywhere in their
// location. Every one of the 20 is a multi-location posting listing
// "US - Remote" ALONGSIDE two or three offices, so calling it REMOTE would
// be wrong in the restrictive direction: it would drop the role out of the
// matches of anyone who asked for on-site or hybrid. Null keeps it visible
// to everyone, which is the honest reading.
function mapWorkplaceType(value: string | null | undefined): WorkMode | null {
  if (!value) return null;
  return WORKPLACE_TYPE_MAP[value.toLowerCase()] ?? null;
}

// Primary plus any secondary locations, joined. matchLocation
// (matching/predicate.ts) is a substring test over this one string, so a
// posting open in both Bengaluru and Singapore has to name both here or it
// silently fails to match half the users it should reach.
function buildLocation(
  location: string | null | undefined,
  secondary: { location?: string | null }[] | null | undefined,
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [location, ...(secondary ?? []).map((s) => s?.location)]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(trimmed);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class AshbyAdapter implements JobSourceAdapter {
  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const { jobBoardName } = validatePlatformConfig("ASHBY", source.config);

    const body = ashbyResponseSchema.parse(await fetchJson(boardUrl(jobBoardName)));

    const jobs = body.jobs
      // isListed was true on every posting sampled, since the endpoint
      // serves a company's public board. Checked anyway, and only against
      // an explicit false: an unlisted posting is one the company has
      // deliberately taken off that board, and emailing someone about it
      // would be surfacing something they can't apply to.
      .filter((raw) => raw.isListed !== false)
      .map((raw) => {
        return {
          externalJobId: raw.id,
          title: raw.title.trim(),
          location: buildLocation(raw.location, raw.secondaryLocations),
          workMode: mapWorkplaceType(raw.workplaceType),
          opportunityTypeHint: mapEmploymentType(raw.employmentType),
          // descriptionPlain in preference to descriptionHtml: Ashby
          // returns both, and the plain form already keeps the paragraph
          // and list breaks that classify.ts reads to tell a "required"
          // section from a "preferred" one. Taking it directly avoids a
          // tag-strip and entity-decode round trip that can only lose
          // information. htmlToText still runs over it downstream and is a
          // no-op on text with no tags.
          description: raw.descriptionPlain?.trim() || raw.descriptionHtml || null,
          sourceUrl: raw.jobUrl,
          postedAt: parseTimestamp(raw.publishedAt),
        } satisfies NormalizedJob;
      });

    // One request returns the whole board: no pagination, no partial-page
    // concept, so a 200 is always the complete list at that instant. Same
    // reasoning as GreenhouseAdapter and LeverAdapter.
    return { jobs, status: "COMPLETE" };
  }
}
