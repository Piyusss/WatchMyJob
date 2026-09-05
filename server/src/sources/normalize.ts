import type { WorkMode } from "@prisma/client";

// Best-effort only: a location string saying "remote" is a reliable REMOTE
// signal. ON_SITE vs HYBRID can't be told apart from a location string
// alone, so this never returns either: an adapter should report "unknown"
// rather than invent a distinction it can't actually see.
export function inferWorkMode(location: string | null): WorkMode | null {
  if (!location) return null;
  return /remote/i.test(location) ? "REMOTE" : null;
}

// Collapses whitespace/case differences so two structurally-identical
// strings from different formatting don't produce different hashes.
export function normalizeForHash(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
