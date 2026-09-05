import { z } from "zod";

// Connection details for each JobSource.platform. Kept separate from the
// adapters that will consume them (Phase 4) so the registry (Phase 2) can
// validate shape at write time without depending on ingestion code.
export const platformConfigSchemas = {
  GREENHOUSE: z.object({ boardToken: z.string().min(1) }),
  LEVER: z.object({ site: z.string().min(1) }),
  // `host` is stored rather than derived because a Workday tenant's
  // datacenter number is not predictable from its name: citi.wd5,
  // ghr.wd1 and capitalone.wd12 are all real, and guessing it wrong just
  // 404s. `tenant` and `site` are the two path segments the CXS endpoint
  // takes (see adapters/workday.ts); `site` is often a plain number ("2").
  WORKDAY: z.object({
    host: z.string().regex(/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i, "must be a <tenant>.wd<n>.myworkdayjobs.com host"),
    tenant: z.string().min(1),
    site: z.string().min(1),
  }),
  ICIMS: z.object({ subdomain: z.string().min(1) }),
  SMARTRECRUITERS: z.object({ company: z.string().min(1) }),
  // The single path segment Ashby's posting API takes, and the same one in
  // jobs.ashbyhq.com/<jobBoardName>. Almost always the company name
  // lowercased, but not derivable from it: "Thinking Machines Lab" is
  // `thinkingmachines` and Hugging Face is `huggingface`, so it is stored
  // rather than computed (see adapters/ashby.ts).
  ASHBY: z.object({ jobBoardName: z.string().min(1) }),
  CUSTOM_HTML: z.object({ url: z.string().url() }),
  RSS: z.object({ feedUrl: z.string().url() }),
  API: z.object({ endpoint: z.string().url() }),
  // No connection details: its "board" is CustomTestJob rows keyed by
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
