import crypto from "node:crypto";
import { normalizeForHash } from "./normalize.js";
import type { NormalizedJob } from "./types.js";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// Stable across edits -- built only from fields that don't change once a
// job is posted. This is the fallback identity Phase 11's cross-source
// merge will key off; a description edit or work-mode correction must
// never change it, or a merged job would look like a new one.
export function computeIdentityHash(companyId: string, job: NormalizedJob): string {
  return sha256(
    [companyId, normalizeForHash(job.title), normalizeForHash(job.location)].join("|"),
  );
}

// Changes whenever anything a user might care about changes. Used by the
// update-detection Phase 6 adds to decide whether a re-fetched job counts
// as "meaningfully updated" -- broader than identityHash on purpose.
export function computeContentHash(job: NormalizedJob): string {
  return sha256(
    [
      normalizeForHash(job.title),
      normalizeForHash(job.location),
      job.workMode ?? "",
      normalizeForHash(job.description),
    ].join("|"),
  );
}
