import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { prisma } from "../db/prisma.js";
import { sourcePlatforms, validatePlatformConfig, type SourcePlatform } from "../sources/configSchemas.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function requireCompany(slug: string | undefined) {
  if (!slug) fail("--company <slug> is required");
  const company = await prisma.company.findUnique({ where: { slug } });
  if (!company) fail(`No company with slug "${slug}"`);
  return company;
}

async function addSource(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      company: { type: "string" },
      platform: { type: "string" },
      config: { type: "string" },
      "poll-interval-seconds": { type: "string" },
    },
  });

  const company = await requireCompany(values.company);

  const platform = values.platform as SourcePlatform | undefined;
  if (!platform || !sourcePlatforms.includes(platform)) {
    fail(`--platform must be one of: ${sourcePlatforms.join(", ")}`);
  }

  let rawConfig: unknown;
  try {
    rawConfig = values.config ? JSON.parse(values.config) : {};
  } catch {
    fail("--config must be valid JSON, e.g. '{\"boardToken\":\"microsoft\"}'");
  }

  let config: unknown;
  try {
    config = validatePlatformConfig(platform, rawConfig);
  } catch (err) {
    if (err instanceof ZodError) {
      fail(`--config is invalid for platform ${platform}: ${err.issues.map((i) => i.message).join("; ")}`);
    }
    throw err;
  }

  const pollIntervalSeconds = values["poll-interval-seconds"]
    ? Number(values["poll-interval-seconds"])
    : undefined;
  if (pollIntervalSeconds !== undefined && (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 60)) {
    fail("--poll-interval-seconds must be a number >= 60");
  }

  const source = await prisma.jobSource.create({
    data: {
      companyId: company.id,
      platform,
      config: config as object,
      ...(pollIntervalSeconds ? { pollIntervalSeconds } : {}),
    },
  });

  console.log(`Added ${platform} source for ${company.name} (source id: ${source.id})`);
}

async function listSources(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { company: { type: "string" } } });
  const company = await requireCompany(values.company);

  const sources = await prisma.jobSource.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "asc" },
  });

  if (sources.length === 0) {
    console.log(`${company.name} has no sources yet.`);
    return;
  }

  console.log(`${company.name} sources:\n`);
  for (const s of sources) {
    console.log(
      `- ${s.platform} · poll every ${s.pollIntervalSeconds}s · ${JSON.stringify(s.config)}${
        s.consecutiveFailures > 0 ? ` · ${s.consecutiveFailures} consecutive failure(s)` : ""
      }`,
    );
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "add":
      return addSource(rest);
    case "list":
      return listSources(rest);
    default:
      console.log("Usage: admin:sources. <add|list> [options]");
      process.exit(command ? 1 : 0);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
