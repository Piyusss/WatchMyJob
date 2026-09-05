import { validatePlatformConfig } from "../configSchemas.js";
import { fetchJson } from "../httpClient.js";
import { leverResponseSchema } from "../responseSchemas.js";
import type { DiscoveryResult, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";
import type { OpportunityType, WorkMode } from "@prisma/client";

// Lever's public postings API (jobs.lever.co-backed companies): same
// spirit as Greenhouse's board API: designed for embedding on a company's
// own careers page, no auth, no ToS conflict. mode=json is what returns
// structured data instead of an HTML page.
function postingsUrl(site: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

// Confirmed against real data (Palantir's live board, 310 postings):
// "hybrid" and "onsite" observed directly; "remote" is Lever's documented
// third value for this field. Reliable and structured: strictly better
// than Greenhouse's location-string regex guess, so used directly instead
// of inferWorkMode() when this adapter has it.
const WORKPLACE_TYPE_MAP: Record<string, WorkMode> = {
  remote: "REMOTE",
  hybrid: "HYBRID",
  onsite: "ON_SITE",
};

// Confirmed against the same real data: "Full-time", "Fixed-Term",
// "Internship", "Contractor" is the full set of values actually observed.
// "Fixed-Term" doesn't map cleanly onto any single OpportunityType value
// (not clearly a CONTRACT, not PART_TIME): OTHER is the honest choice
// rather than guessing. Anything unrecognized falls through to title-based
// classification (classify.ts) instead of being forced into a category.
const COMMITMENT_MAP: Record<string, OpportunityType> = {
  "full-time": "FULL_TIME",
  internship: "INTERNSHIP",
  contractor: "CONTRACT",
  "part-time": "PART_TIME",
  "fixed-term": "OTHER",
};

function mapWorkplaceType(value: string | null): WorkMode | null {
  if (!value) return null;
  return WORKPLACE_TYPE_MAP[value.toLowerCase()] ?? null;
}

function mapCommitment(value: string | undefined): OpportunityType | null {
  if (!value) return null;
  return COMMITMENT_MAP[value.toLowerCase()] ?? null;
}

export class LeverAdapter implements JobSourceAdapter {
  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const { site } = validatePlatformConfig("LEVER", source.config);

    const rawBody = await fetchJson(postingsUrl(site));
    const raw = leverResponseSchema.parse(rawBody);

    const jobs = raw.map((posting) => {
      const location = posting.categories?.location?.trim() || null;
      return {
        externalJobId: posting.id,
        title: posting.text.trim(),
        location,
        workMode: mapWorkplaceType(posting.workplaceType),
        opportunityTypeHint: mapCommitment(posting.categories?.commitment),
        description: posting.description,
        sourceUrl: posting.hostedUrl,
        postedAt: new Date(posting.createdAt),
      } satisfies NormalizedJob;
    });

    // One request, no pagination on this endpoint: always the complete
    // list, same reasoning as GreenhouseAdapter.
    return { jobs, status: "COMPLETE" };
  }
}
