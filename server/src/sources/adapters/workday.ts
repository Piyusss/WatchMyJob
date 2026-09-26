import type { OpportunityType, WorkMode } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { validatePlatformConfig } from "../configSchemas.js";
import { fetchJson } from "../httpClient.js";
import { inferWorkMode } from "../normalize.js";
import { workdayDetailResponseSchema, workdayListResponseSchema } from "../responseSchemas.js";
import type { DiscoveryResult, FetchStatus, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";

// Workday's CXS endpoint is the JSON API a tenant's own careers page calls to
// render its job list: no auth, no key, same requests the public site makes.
// Unlike Greenhouse and Lever it takes two calls to get a usable job: the
// search endpoint enumerates postings but omits the description and any real
// posting date, both of which only exist on the per-job detail record.
//
// Verified live against six tenants (Bank of America, Citi, Capital One,
// U.S. Bank, State Street, Mastercard) before this adapter was written; the
// constants and quirks below are all observed behavior, not assumptions.

// The search endpoint silently rejects a limit above 20: 50 and 100 both
// return a non-JSON error rather than a clamped page. 20 is not a tuning
// choice here, it is the only value that works.
const PAGE_SIZE = 20;

// Ceiling on how far pagination will walk before giving up and reporting the
// result as incomplete. 300 pages is 6,000 postings, comfortably past the
// largest board observed (~2,100) while still bounding a source that never
// terminates.
const MAX_PAGES = 300;

// Confirmed values from live tenants: "Hybrid" and "On-Site" observed
// directly on Citi's board, "Remote" is Workday's documented third value.
// Structured and reliable, so preferred over inferWorkMode()'s location-text
// guess: same precedent as LeverAdapter's workplaceType handling.
const REMOTE_TYPE_MAP: Record<string, WorkMode> = {
  remote: "REMOTE",
  hybrid: "HYBRID",
  onsite: "ON_SITE",
};

// Workday's own commitment vocabulary. Anything unrecognized deliberately
// falls through to classify.ts's title-based inference rather than being
// forced into a category: same reasoning as LeverAdapter's COMMITMENT_MAP.
const TIME_TYPE_MAP: Record<string, OpportunityType> = {
  "full time": "FULL_TIME",
  "part time": "PART_TIME",
  intern: "INTERNSHIP",
  contingent: "CONTRACT",
};

// How many detail records to fetch at once during one sync. Sequential would
// make a first baseline of a 2,000-job board take over ten minutes of wall
// clock; four at a time keeps that tolerable while staying far below the
// concurrency a browser rendering the same careers page produces.
const DETAIL_CONCURRENCY = 4;

function searchUrl(host: string, tenant: string, site: string): string {
  return `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
}

function detailUrl(host: string, tenant: string, site: string, externalPath: string): string {
  // externalPath already begins with "/job/...", straight from the search
  // response: it is Workday's own pointer to the record, not a path this
  // adapter composes.
  return `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${externalPath}`;
}

// The page a human would land on, which is what belongs in a notification
// email. Composed from the list response so it is identical for every job,
// including the ones that never get a detail fetch (see below).
function publicUrl(host: string, site: string, externalPath: string): string {
  return `https://${host}/${encodeURIComponent(site)}${externalPath}`;
}

function mapRemoteType(value: string | null | undefined): WorkMode | null {
  if (!value) return null;
  return REMOTE_TYPE_MAP[value.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

function mapTimeType(value: string | null | undefined): OpportunityType | null {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  return TIME_TYPE_MAP[key] ?? TIME_TYPE_MAP[key.replace(/[-_]/g, " ")] ?? null;
}

// Workday reports two posting dates and only one of them is usable:
// `postedOn` is display prose ("Posted Today", "Posted 30+ Days Ago") that
// cannot be turned back into an instant, while `startDate` is a real ISO
// date. Parsing the prose would manufacture a precise timestamp out of a
// vague one, so it is ignored entirely and an unparseable date stays null.
function parseStartDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A posting's stable identity. bulletFields carries the company's own
// requisition number (26992731) and was present on every posting across all
// six tenants probed; externalPath is the fallback only if a tenant ever
// omits it, and is itself stable and unique per posting.
function externalIdOf(posting: { bulletFields?: string[]; externalPath?: string }): string {
  return posting.bulletFields?.[0]?.trim() || posting.externalPath || "";
}

// What the pipeline already knows about this source's jobs, so an unchanged
// posting doesn't need its detail record re-fetched every cycle.
export interface KnownJobSnapshot {
  description: string | null;
  postedAt: Date | null;
  workMode: WorkMode | null;
  opportunityType: OpportunityType | null;
}

export type KnownJobLoader = (sourceId: string) => Promise<Map<string, KnownJobSnapshot>>;

const loadKnownJobsFromDb: KnownJobLoader = async (sourceId) => {
  const rows = await prisma.job.findMany({
    where: { sourceId },
    select: { externalJobId: true, description: true, postedAt: true, workMode: true, opportunityType: true },
  });
  return new Map(
    rows.map((r) => [
      r.externalJobId,
      { description: r.description, postedAt: r.postedAt, workMode: r.workMode, opportunityType: r.opportunityType },
    ]),
  );
};

// Runs `worker` over `items` with at most `limit` in flight, preserving input
// order in the result. Kept local: this is the only place in the codebase
// that fans out requests, and every other loop is deliberately sequential.
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

interface ListedPosting {
  externalJobId: string;
  title: string;
  location: string | null;
  externalPath: string;
}

export class WorkdayAdapter implements JobSourceAdapter {
  // The loader is injectable so the fixture test can exercise the real
  // pagination and mapping logic without a database, the same way the rest
  // of the codebase uses explicit test seams (setAdapterForTesting,
  // setUserResolverForTesting).
  constructor(private readonly loadKnownJobs: KnownJobLoader = loadKnownJobsFromDb) {}

  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const { host, tenant, site } = validatePlatformConfig("WORKDAY", source.config);

    const { postings, status } = await this.enumerate(host, tenant, site);

    // Only postings this source has never persisted need a detail request.
    // A board of 2,000 jobs would otherwise cost 2,000 extra requests on
    // every poll to re-read descriptions that almost never change; instead
    // a known job reuses the description, date and work mode already stored
    // for it, which also keeps its contentHash stable so sync.ts sees it as
    // genuinely unchanged rather than churning it every cycle.
    //
    // The tradeoff, stated plainly: a description edited in place on an
    // otherwise-identical posting is not picked up. That is accepted here
    // because re-reading every description every four minutes is not, and
    // because the alternative costs two orders of magnitude more requests
    // against someone else's API.
    const known = await this.loadKnownJobs(source.id);
    const needingDetail = postings.filter((p) => !known.has(p.externalJobId));

    const details = new Map<string, DetailFields>();
    const fetched = await mapWithConcurrency(needingDetail, DETAIL_CONCURRENCY, async (posting) => {
      const raw = await fetchJson(detailUrl(host, tenant, site, posting.externalPath));
      const parsed = workdayDetailResponseSchema.parse(raw);
      return { externalJobId: posting.externalJobId, info: parsed.jobPostingInfo };
    });
    for (const { externalJobId, info } of fetched) {
      details.set(externalJobId, {
        description: info.jobDescription ?? null,
        postedAt: parseStartDate(info.startDate),
        workMode: mapRemoteType(info.remoteType),
        opportunityType: mapTimeType(info.timeType),
      });
    }

    const jobs = postings.map((posting) => {
      const detail = details.get(posting.externalJobId);
      const previous = known.get(posting.externalJobId);
      // Freshly fetched detail wins; otherwise what's already stored for a
      // job we've seen before. Exactly one of these is set in practice.
      const best = detail ?? previous ?? null;

      return {
        externalJobId: posting.externalJobId,
        title: posting.title,
        location: posting.location,
        // Structured remoteType when the detail record gave one, the stored
        // value for a job already known, and only then the location-string
        // guess: never a guess over a real signal.
        workMode: best?.workMode ?? inferWorkMode(posting.location),
        opportunityTypeHint: best?.opportunityType ?? null,
        description: best?.description ?? null,
        sourceUrl: publicUrl(host, site, posting.externalPath),
        postedAt: best?.postedAt ?? null,
      } satisfies NormalizedJob;
    });

    return { jobs, status };
  }

  // Walks the search endpoint until it genuinely runs out of postings, and
  // reports whether the walk actually reached the end.
  //
  // This is the part that matters most. Citi's tenant stops advancing at
  // offset 2000: every request past it returns a full, valid-looking page of
  // the SAME twenty postings, forever: no error, no empty page, no signal
  // in `total` (which reads 0 at offset 1980 and 2000 at offset 2000 on the
  // same board). Bank of America, whose board is larger, terminates properly
  // with a short page then an empty one. So neither `total` nor "the page
  // was full" can decide when to stop.
  //
  // A page containing no posting we haven't already seen is the only
  // reliable signature of that clamp, and hitting it means the enumeration
  // is genuinely incomplete: postings exist that this walk cannot reach.
  // Reporting COMPLETE there would tell sync.ts that every unseen job had
  // vanished, and the closure logic would eventually close thousands of live
  // postings. PARTIAL is what makes absence prove nothing (see types.ts's
  // FetchStatus and sync.ts's fetchStatus check).
  private async enumerate(
    host: string,
    tenant: string,
    site: string,
  ): Promise<{ postings: ListedPosting[]; status: FetchStatus }> {
    const url = searchUrl(host, tenant, site);
    const seen = new Set<string>();
    const postings: ListedPosting[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await fetchJson(url, {
        method: "POST",
        jsonBody: { appliedFacets: {}, limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: "" },
      });
      const body = workdayListResponseSchema.parse(raw);

      // The clean end of the list: Workday returns an empty array once the
      // offset is past the last posting.
      if (body.jobPostings.length === 0) {
        return { postings, status: "COMPLETE" };
      }

      const fresh = body.jobPostings.filter((p) => !seen.has(externalIdOf(p)));

      // Every posting on this page was already collected. Not ordinary churn:
      // a board reshuffling between requests still yields *some* new
      // posting: but the clamp described above.
      if (fresh.length === 0) {
        return { postings, status: "PARTIAL" };
      }

      for (const posting of fresh) {
        const externalJobId = externalIdOf(posting);
        seen.add(externalJobId);
        // A stub listing (requisition id only: no title, no page to link
        // to) is not a job anyone can view or apply to, so it isn't one
        // here. It still counts toward `fresh` above, so skipping it never
        // makes a page look like a repeat and flip the walk to PARTIAL.
        if (!posting.title || !posting.externalPath) continue;
        postings.push({
          externalJobId,
          title: posting.title.trim(),
          location: posting.locationsText?.trim() || null,
          externalPath: posting.externalPath,
        });
      }

      // A short page means this was the last one; Workday fills every page
      // before it.
      if (body.jobPostings.length < PAGE_SIZE) {
        return { postings, status: "COMPLETE" };
      }
    }

    // Ran out of pages before the source ran out of jobs. Same reasoning as
    // the clamp: the walk didn't finish, so absence can't be trusted.
    return { postings, status: "PARTIAL" };
  }
}

interface DetailFields {
  description: string | null;
  postedAt: Date | null;
  workMode: WorkMode | null;
  opportunityType: OpportunityType | null;
}
