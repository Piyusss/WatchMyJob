// One-shot manual sync for a company's sources: the same discover ->
// diff-against-Postgres -> persist pass the worker (src/worker.ts) runs on
// each source's own schedule. Useful for triggering a sync on demand
// without waiting for the next scheduled tick.
//
// Usage:
//   npm run admin:sync -- --company figma
import { parseArgs } from "node:util";
import { prisma } from "../db/prisma.js";
import { syncCompany } from "../sources/sync.js";
import { summarizeSyncResult } from "../sources/format.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { company: { type: "string" } } });
  if (!values.company) fail("--company <slug> is required");

  const results = await syncCompany(values.company);

  if (results.length === 0) {
    console.log(`${values.company} has no sources configured yet.`);
    return;
  }

  for (const r of results) {
    if (r.error) {
      console.log(`✕ ${r.platform} (${r.sourceId}): FAILED: ${r.error}`);
    } else {
      console.log(`✓ ${r.platform} (${r.sourceId}): ${summarizeSyncResult(r)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
