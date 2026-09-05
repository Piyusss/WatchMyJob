// Backfills classification (role family, level, opportunity type,
// experience) onto jobs stored before this classifier existed, or before a
// change to it. A normal sync cycle deliberately does NOT reclassify a job
// whose contentHash hasn't changed (see sync.ts's "unchanged" branch):
// title and description are unchanged, so classification would be
// identical, and writing it again is wasted work on the common case. But
// that means shipping a new/changed classifier does nothing for existing
// rows until this is run once.
//
// Usage:
//   npm run admin:reclassify                  (every job)
//   npm run admin:reclassify -- --company figma
import { parseArgs } from "node:util";
import { prisma } from "../db/prisma.js";
import { classifyJob } from "../sources/classify.js";

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { company: { type: "string" } } });

  const where = values.company ? { company: { slug: values.company } } : {};
  const jobs = await prisma.job.findMany({ where, select: { id: true, title: true, description: true } });

  if (jobs.length === 0) {
    console.log(values.company ? `No jobs found for "${values.company}".` : "No jobs in the database yet.");
    return;
  }

  let changed = 0;
  for (const job of jobs) {
    const classification = classifyJob(job);
    await prisma.job.update({ where: { id: job.id }, data: classification });
    changed++;
  }

  console.log(`Reclassified ${changed} job(s)${values.company ? ` for "${values.company}"` : ""}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
