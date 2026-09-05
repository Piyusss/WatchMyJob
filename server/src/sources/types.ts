import type { OpportunityType, WorkMode } from "@prisma/client";

// What every adapter produces, regardless of the platform underneath.
// Deliberately narrow: role/level extraction and geo-splitting are
// deterministic-normalization work that belongs to later phases (see
// prisma/schema.prisma's Job model comments): an adapter should never
// guess a field it can't reliably fill.
export interface NormalizedJob {
  externalJobId: string;
  title: string;
  location: string | null;
  workMode: WorkMode | null;
  // Populated only when the source itself hands back a structured signal
  // more reliable than title parsing: Lever's categories.commitment field
  // ("Full-time" | "Internship" | "Contractor" | "Fixed-Term"), discovered
  // while building that adapter (Phase 11). Greenhouse has no equivalent
  // field and leaves this null; classify.ts (Phase 8) falls back to
  // title-based inference whenever it's absent, so this is additive, not a
  // second competing classification path.
  opportunityTypeHint?: OpportunityType | null;
  // Same "structured signal beats title parsing" precedent as
  // opportunityTypeHint above, for a source whose jobs never had a title to
  // parse in the first place: currently only the CUSTOM_TEST adapter
  // (see adapters/customTest.ts), whose admin-authored jobs pick role/level
  // from the same controlled dropdowns real user preferences use, so
  // there's a clean structured value to hand over directly instead of
  // reverse-engineering it out of a composed title string.
  roleFamilyHint?: string | null;
  levelHint?: string | null;
  experienceHint?: {
    status: "KNOWN" | "UNKNOWN";
    requiredMin: number | null;
    requiredMax: number | null;
  } | null;
  description: string | null;
  sourceUrl: string;
  postedAt: Date | null;
}

export interface JobSourceConfig {
  id: string;
  companyId: string;
  config: unknown;
}

// COMPLETE: the adapter enumerated every job the source currently has.
// Absence of a previously-known job in this result is meaningful evidence
// it may be gone. PARTIAL: the adapter got real data but knows it isn't the
// whole picture (e.g. only fetched one page of a paginated scrape):
// absence here proves nothing, and sync.ts must not treat it as a missing
// signal. A hard failure is not a status value; it's the discoverJobs()
// promise rejecting.
export type FetchStatus = "COMPLETE" | "PARTIAL";

export interface DiscoveryResult {
  jobs: NormalizedJob[];
  status: FetchStatus;
}

export interface JobSourceAdapter {
  // Fetches the source's current job list, fully normalized, plus whether
  // that list is known-complete. sync.ts diffs the result against Postgres's
  // current ACTIVE rows for this source to find new/updated/missing jobs:
  // an adapter is never asked to track its own state between calls.
  discoverJobs(source: JobSourceConfig): Promise<DiscoveryResult>;
}
