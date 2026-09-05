// Establishes a company's baseline inventory: imports everything its
// sources currently have open, flagged as pre-existing, and only then marks
// each source as having a baseline. A company is not selectable by users
// until every one of its sources has been through this: that gate is what
// makes "existing jobs never notify a new subscriber" an enforced invariant
// rather than a hope.
//
// Usage:
//   npm run admin:initial-sync -- --company figma
//   npm run admin:initial-sync -- --company figma --allow-empty   (confirms a genuinely 0-job board)
import { parseArgs } from "node:util";
import { prisma } from "../db/prisma.js";
import { runInitialSync } from "../sources/sync.js";
import { SELECTABLE_COMPANY } from "../companies/selectable.js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { company: { type: "string" }, "allow-empty": { type: "boolean" } },
  });
  if (!values.company) fail("--company <slug> is required");

  const results = await runInitialSync(values.company, { allowEmpty: values["allow-empty"] });

  if (results.length === 0) {
    console.log(`Nothing to do: every source for "${values.company}" already has a baseline.`);
  } else {
    for (const r of results) {
      if (r.error) {
        console.log(`✕ ${r.platform} (${r.sourceId}): FAILED: ${r.error}`);
      } else {
        console.log(
          `✓ ${r.platform} (${r.sourceId}): baseline established: ${r.created} existing job(s) imported, flagged as pre-existing`,
        );
      }
    }
  }

  const company = await prisma.company.findUnique({ where: { slug: values.company } });
  // Reuses the exact predicate the listing/subscribe endpoints enforce,
  // rather than a second hand-rolled copy that could quietly drift from it.
  const selectable = company ? await prisma.company.findFirst({ where: { id: company.id, ...SELECTABLE_COMPANY } }) : null;

  console.log(
    selectable ? `\n${company?.name} is now selectable by users.` : `\n${company?.name} is NOT yet selectable.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
