import { z } from "zod";

// Connection details for each JobSource.platform. Kept separate from the
// adapters that will consume them (Phase 4) so the registry (Phase 2) can
// validate shape at write time without depending on ingestion code.
export const platformConfigSchemas = {
  GREENHOUSE: z.object({ boardToken: z.string().min(1) }),
  LEVER: z.object({ site: z.string().min(1) }),
  WORKDAY: z.object({ tenant: z.string().min(1), site: z.string().min(1) }),
  ICIMS: z.object({ subdomain: z.string().min(1) }),
  SMARTRECRUITERS: z.object({ company: z.string().min(1) }),
  CUSTOM_HTML: z.object({ url: z.string().url() }),
  RSS: z.object({ feedUrl: z.string().url() }),
  API: z.object({ endpoint: z.string().url() }),
  // No connection details -- its "board" is CustomTestJob rows keyed by
  // this JobSource's own id (see adapters/customTest.ts), not anything
  // reachable over the network.
  CUSTOM_TEST: z.object({}),
} as const;

export type SourcePlatform = keyof typeof platformConfigSchemas;

export const sourcePlatforms = Object.keys(platformConfigSchemas) as SourcePlatform[];

export function validatePlatformConfig<P extends SourcePlatform>(
  platform: P,
  config: unknown,
): z.infer<(typeof platformConfigSchemas)[P]> {
  return platformConfigSchemas[platform].parse(config);
}
