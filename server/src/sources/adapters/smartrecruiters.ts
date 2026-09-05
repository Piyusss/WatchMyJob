import { validatePlatformConfig } from "../configSchemas.js";
import { fetchJson } from "../httpClient.js";
import { smartRecruitersResponseSchema } from "../responseSchemas.js";
import type { DiscoveryResult, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";
import type { OpportunityType, WorkMode } from "@prisma/client";

// SmartRecruiters' public postings API: keyless, and the same "built to be
// embedded on the company's own careers page" basis as Greenhouse and
// Lever, so it qualifies as OFFICIAL_API rather than a scrape.
//
// This is the platform that reaches employers the other two adapters can't.
// Greenhouse and Lever skew heavily to product companies; SmartRecruiters
// is where large industrial and service employers run their boards while
// serving them under their own careers domain: Continental, Accor, Sodexo,
// SIXT, Wabtec and Delivery Hero were all verified live against it.
const PAGE_SIZE = 100; // the API's own maximum

// A guard, not an expectation: the largest board seen while building this
// was Delivery Hero at 983 postings (10 pages). Hitting this cap means
// something changed by an order of magnitude, and the result is reported
// PARTIAL so closure.ts never reads the jobs we didn't fetch as "missing".
const MAX_PAGES = 30;

function postingsUrl(company: string, offset: number): string {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
}

// Verified against live boards (Sodexo, Continental, Accor: 300 postings
// sampled). `permanent` carrying the label "Full-time" is why this maps on
// id rather than label. `casual` has no clean OpportunityType and becomes
// OTHER rather than a guess, matching how Lever's "Fixed-Term" is handled.
const EMPLOYMENT_TYPE_MAP: Record<string, OpportunityType> = {
  permanent: "FULL_TIME",
  "full-time": "FULL_TIME",
  "part-time": "PART_TIME",
  intern: "INTERNSHIP",
  internship: "INTERNSHIP",
  contract: "CONTRACT",
  casual: "OTHER",
  temporary: "OTHER",
};

// Deliberately partial. The observed values are internship, entry_level,
// associate, mid_senior_level, director, executive and not_applicable, but
// LEVEL_OPTIONS (web/src/lib/api.ts) is Intern/Associate/Senior/Lead/
// Staff/Principal, and only two of those line up without inventing a
// mapping. "mid_senior_level" spans mid AND senior in one value: calling it
// "Senior" would silently over-promote every mid-level posting, and level
// is a hard gate in matching/predicate.ts, so a wrong value here suppresses
// or fires real alerts. Everything unmapped stays null and falls through to
// title-based classification (classify.ts), which is exactly the
// "never invent a field you can't reliably fill" rule the Job model states.
const LEVEL_MAP: Record<string, string> = {
  internship: "Intern",
  associate: "Associate",
};

function mapEmploymentType(id: string | undefined): OpportunityType | null {
  if (!id) return null;
  return EMPLOYMENT_TYPE_MAP[id.toLowerCase()] ?? null;
}

function mapLevel(id: string | undefined): string | null {
  if (!id) return null;
  return LEVEL_MAP[id.toLowerCase()] ?? null;
}

// Structured booleans, not a location-string guess, so this is reliable in
// the way Lever's workplaceType is and Greenhouse's regex isn't. Both false
// is an explicit statement of on-site rather than an absence of
// information, which is why ON_SITE is returned instead of null.
function mapWorkMode(location: { remote?: boolean; hybrid?: boolean } | null | undefined): WorkMode | null {
  if (!location) return null;
  if (location.remote) return "REMOTE";
  if (location.hybrid) return "HYBRID";
  if (location.remote === false && location.hybrid === false) return "ON_SITE";
  return null;
}

function buildLocation(location: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  fullLocation?: string | null;
} | null | undefined): string | null {
  if (!location) return null;
  const full = location.fullLocation?.trim();
  if (full) return full;
  const parts = [location.city, location.region, location.country].map((p) => p?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class SmartRecruitersAdapter implements JobSourceAdapter {
  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const { company } = validatePlatformConfig("SMARTRECRUITERS", source.config);

    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let pages = 0;
    let complete = true;

    for (;;) {
      const body = smartRecruitersResponseSchema.parse(await fetchJson(postingsUrl(company, offset)));
      pages++;

      for (const raw of body.content) {
        const id = raw.id.trim();
        // Paging by offset over a list that can shift between requests can
        // hand back the same posting twice. Deduped here rather than left
        // for sync.ts, which would otherwise see two rows racing for one
        // externalJobId inside a single transaction.
        if (seen.has(id)) continue;
        seen.add(id);

        jobs.push({
          externalJobId: id,
          title: raw.name.trim(),
          location: buildLocation(raw.location),
          workMode: mapWorkMode(raw.location),
          opportunityTypeHint: mapEmploymentType(raw.typeOfEmployment?.id),
          levelHint: mapLevel(raw.experienceLevel?.id),
          // The list endpoint carries no description, and the per-posting
          // detail endpoint would mean one request per job (983 of them on
          // the largest board here) on every poll. Left null rather than
          // paying that cost: classification reads the title, and the job
          // page links out to the real posting anyway.
          description: null,
          // Derived, not fetched: the detail endpoint's postingUrl is the
          // slugged form of exactly this, and this bare form was verified
          // to resolve 200 and redirect to it.
          sourceUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(raw.company.identifier)}/${encodeURIComponent(id)}`,
          postedAt: parseTimestamp(raw.releasedDate),
        } satisfies NormalizedJob);
      }

      offset += PAGE_SIZE;
      // An empty page ends the walk even if totalFound disagrees, so a
      // miscounted total can't spin this loop.
      if (body.content.length === 0 || offset >= body.totalFound) break;
      if (pages >= MAX_PAGES) {
        complete = false;
        break;
      }
    }

    return { jobs, status: complete ? "COMPLETE" : "PARTIAL" };
  }
}
