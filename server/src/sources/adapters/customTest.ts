import { prisma } from "../../db/prisma.js";
import type { DiscoveryResult, JobSourceAdapter, JobSourceConfig, NormalizedJob } from "../types.js";

// Mirrors web/src/components/LocationPicker.tsx's own locationLabel: a
// job posting only ever has ONE location string (see schema.prisma's
// Job.location comment), so multiple admin-picked locations are joined the
// same way a real multi-location Greenhouse/Lever posting's raw location
// text would read, and matched the same way too (predicate.ts substring-
// matches against this single field regardless of source).
function locationLabel(loc: { cityName: string | null; stateName: string | null; countryName: string }): string {
  return [loc.cityName, loc.stateName, loc.countryName].filter(Boolean).join(", ");
}

// The admin/test tab's own "ATS" (see testCompanies/routes.ts): discovers
// jobs from CustomTestJob rows instead of an HTTP fetch, but is otherwise an
// adapter like any other: sync.ts diffs its result against Postgres exactly
// the same way. Only PUBLISHED drafts are visible; creating a draft alone
// never enters the pipeline (Section 8's "creating must not itself send a
// notification"). Always COMPLETE: every call enumerates every published
// row for this source, so a job an admin un-publishes would correctly read
// as missing under the same closure logic a real source's disappearance
// jobs use, without needing a separate code path for test data.
export class CustomTestAdapter implements JobSourceAdapter {
  async discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult> {
    const drafts = await prisma.customTestJob.findMany({
      where: { sourceId: source.id, publishedAt: { not: null } },
      include: { locations: true },
    });

    const jobs: NormalizedJob[] = drafts.map((draft) => {
      // Structured admin input, not text to search: an explicit KNOWN/
      // UNKNOWN choice rather than running the min/max regex classify.ts
      // uses for real descriptions (see classify.ts's experienceHint).
      const hasExperience = draft.requiredExperienceMin !== null || draft.requiredExperienceMax !== null;

      return {
        externalJobId: draft.id,
        title: draft.title,
        location: draft.locations.length > 0 ? draft.locations.map(locationLabel).join("; ") : null,
        workMode: draft.workMode,
        opportunityTypeHint: draft.opportunityType,
        roleFamilyHint: draft.roleFamily,
        levelHint: draft.level,
        experienceHint: {
          status: hasExperience ? "KNOWN" : "UNKNOWN",
          requiredMin: draft.requiredExperienceMin,
          requiredMax: draft.requiredExperienceMax,
        },
        description: draft.description,
        sourceUrl: draft.applicationUrl,
        postedAt: draft.publishedAt,
      };
    });

    return { jobs, status: "COMPLETE" };
  }
}
