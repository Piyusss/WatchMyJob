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
import { matchJobAgainstSubscribers } from "../matching/engine.js";

// The classification fields the matching engine actually reads (see
// sync.ts's MATCH_RELEVANT_SELECT, restricted to the subset classifyJob can
// touch: it never sees location or workMode). A normal sync cycle stamps
// lastMatchRelevantChangeAt and re-runs matching itself whenever one of
// these changes (sync.ts); this backfill has to do the same thing by hand,
// or a classifier fix would silently never reach anyone. Without it, a job
// that only NOW matches a subscriber's preferences because of the improved
// classification would still have a stale lastMatchRelevantChangeAt (or
// none at all) and would never notify: firstSeenAt already predates most
// existing subscriptions by definition (that's exactly why these jobs are
// old enough to need reclassifying), and eligibility.ts's fallback only
// fires on a genuine change to one of these fields.
function matchRelevantFieldsChanged(
  before: { roleFamily: string | null; level: string | null; opportunityType: string; experienceStatus: string; requiredExperienceMin: number | null; requiredExperienceMax: number | null },
  after: { roleFamily: string | null; level: string | null; opportunityType: string; experienceStatus: string; requiredExperienceMin: number | null; requiredExperienceMax: number | null },
): boolean {
  return (
    before.roleFamily !== after.roleFamily ||
    before.level !== after.level ||
    before.opportunityType !== after.opportunityType ||
    before.experienceStatus !== after.experienceStatus ||
    before.requiredExperienceMin !== after.requiredExperienceMin ||
    before.requiredExperienceMax !== after.requiredExperienceMax
  );
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { company: { type: "string" } } });

  const where = values.company ? { company: { slug: values.company } } : {};
  const jobs = await prisma.job.findMany({
    where,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      roleFamily: true,
      level: true,
      opportunityType: true,
      experienceStatus: true,
      requiredExperienceMin: true,
      requiredExperienceMax: true,
    },
  });

  if (jobs.length === 0) {
    console.log(values.company ? `No jobs found for "${values.company}".` : "No jobs in the database yet.");
    return;
  }

  let changed = 0;
  let rematched = 0;
  let queued = 0;
  for (const job of jobs) {
    const classification = classifyJob(job);
    const relevantChange = matchRelevantFieldsChanged(job, classification);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        ...classification,
        ...(relevantChange ? { lastMatchRelevantChangeAt: new Date() } : {}),
      },
    });
    changed++;

    // Only an ACTIVE job can still be matched against subscribers; a CLOSED
    // one has nothing to notify anyone about regardless of classification.
    if (relevantChange && job.status === "ACTIVE") {
      rematched++;
      queued += await matchJobAgainstSubscribers(job.id);
    }
  }

  console.log(
    `Reclassified ${changed} job(s)${values.company ? ` for "${values.company}"` : ""}` +
      (rematched > 0 ? `, re-matched ${rematched} of them (${queued} notification(s) queued).` : "."),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
