import type { SourcePlatform } from "@prisma/client";
import type { JobSourceAdapter } from "./types.js";
import { GreenhouseAdapter } from "./adapters/greenhouse.js";
import { LeverAdapter } from "./adapters/lever.js";

// One entry per ATS platform, not per company -- adding company #51 on an
// already-supported platform is a JobSource config row (Phase 2's admin
// CLI), never a new file here.
const adapters: Partial<Record<SourcePlatform, JobSourceAdapter>> = {
  GREENHOUSE: new GreenhouseAdapter(),
  LEVER: new LeverAdapter(),
};

export function getAdapter(platform: SourcePlatform): JobSourceAdapter {
  const adapter = adapters[platform];
  if (!adapter) {
    throw new Error(`No adapter implemented yet for platform ${platform}`);
  }
  return adapter;
}

export function supportedPlatforms(): SourcePlatform[] {
  return Object.keys(adapters) as SourcePlatform[];
}

// Test-only seam: lets a test exercise syncSource's own logic (the
// empty-baseline guard, the ordering guards) against a controlled result
// set, without depending on a real adapter's network behavior or on a
// platform with no adapter at all. Never called from production code.
export function setAdapterForTesting(platform: SourcePlatform, adapter: JobSourceAdapter | undefined): void {
  if (adapter) {
    adapters[platform] = adapter;
  } else {
    delete adapters[platform];
  }
}
