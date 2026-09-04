import { validatePlatformConfig } from "../configSchemas.js";
import { inferWorkMode } from "../normalize.js";
import { fetchJson } from "../httpClient.js";
import { greenhouseBoardResponseSchema } from "../responseSchemas.js";
import type { DiscoveryResult, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";

// Greenhouse's public job-board API is designed to be embedded on company
// career pages -- no auth, no ToS conflict, and content=true returns full
// descriptions in the same call, so this adapter never needs a second
// per-job fetch the way a platform without that option would.
function boardUrl(boardToken: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
}

// `new Date(isoStringWithOffset)` parses the source's stated offset and
// stores the equivalent UTC instant -- Postgres's timestamptz column then
// keeps it as UTC regardless of which timezone the source reported in.
// This *is* "UTC normalization at ingestion": correct by construction, not
// by an extra conversion step.
function parseTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class GreenhouseAdapter implements JobSourceAdapter {
  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const { boardToken } = validatePlatformConfig("GREENHOUSE", source.config);

    const rawBody = await fetchJson(boardUrl(boardToken));
    const body = greenhouseBoardResponseSchema.parse(rawBody);

    const jobs = body.jobs.map((raw) => {
      const location = raw.location?.name?.trim() || null;
      return {
        externalJobId: String(raw.id),
        title: raw.title.trim(),
        location,
        workMode: inferWorkMode(location),
        description: raw.content,
        sourceUrl: raw.absolute_url,
        postedAt: parseTimestamp(raw.first_published),
      } satisfies NormalizedJob;
    });

    // This endpoint is a single request returning the whole board -- no
    // pagination, no partial-page concept. A 200 response is always the
    // complete list at that instant, so this adapter can only ever report
    // COMPLETE (or throw, on the paths above).
    return { jobs, status: "COMPLETE" };
  }
}
