import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { htmlToText } from "../sources/htmlText.js";
import {
  getMatchExplanation,
  matchesPreferences,
  type MatchableJob,
  type MatchablePreferences,
} from "../matching/predicate.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const jobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  // Opaque cursor: the id of the last job on the previous page. Paired with
  // a stable sort (id is always the final tiebreaker below), so a cursor
  // reliably resumes even if two jobs share the same sort-key timestamp.
  cursor: z.string().uuid().optional(),
  sort: z.enum(["newest", "updated"]).default("newest"),
  // Comma-separated company slugs -- narrows the watchlist, doesn't expand
  // it; a slug the user doesn't watch has no effect.
  companies: z.string().optional(),
  roleFamily: z.string().trim().max(200).optional(),
  level: z.string().trim().max(100).optional(),
  workMode: z.enum(["REMOTE", "HYBRID", "ON_SITE"]).optional(),
  opportunityType: z.enum(["FULL_TIME", "INTERNSHIP", "CONTRACT", "PART_TIME", "OTHER"]).optional(),
  location: z.string().trim().max(200).optional(),
  q: z.string().trim().max(200).optional(),
});

const JOB_SELECT = {
  id: true,
  title: true,
  location: true,
  workMode: true,
  sourceUrl: true,
  postedAt: true,
  firstSeenAt: true,
  lastMatchRelevantChangeAt: true,
  discoveredInInitialSync: true,
  status: true,
  roleFamily: true,
  level: true,
  opportunityType: true,
  experienceStatus: true,
  requiredExperienceMin: true,
  requiredExperienceMax: true,
  company: { select: { name: true, slug: true } },
} as const;

const PREFERENCES_SELECT = {
  roleFamily: true,
  roleLevel: true,
  yearsExperience: true,
  toleranceYears: true,
  country: true,
  state: true,
  city: true,
  workMode: true,
  opportunityTypes: true,
} as const;

type SelectedJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

// "newest" = when JobDrop first saw it. "updated" = when it was last
// matching-relevantly changed (a reopened or meaningfully-edited posting),
// falling back to firstSeenAt for a job that's never had one -- there's no
// single column that means "recently updated" on its own (lastSeenAt is
// bumped by every sync cycle for every still-open job, unchanged or not,
// so it can't distinguish "this job changed" from "we re-confirmed it's
// still there").
function sortKey(job: SelectedJob, sort: "newest" | "updated"): number {
  if (sort === "newest") return job.firstSeenAt.getTime();
  return (job.lastMatchRelevantChangeAt ?? job.firstSeenAt).getTime();
}

// Active openings at the companies this user currently watches, filtered by
// their saved preferences using the SAME predicate that gates notifications
// (matching/predicate.ts) -- what's shown here is exactly "the jobs that
// would notify you," not a superset. A user with no saved preferences yet
// (shouldn't normally reach this page -- the frontend redirects to
// onboarding first, see auth/routes.ts's hasPreferences) falls back to the
// unfiltered watch-list view rather than showing nothing.
export async function jobRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = jobsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    }
    const query = parsed.data;

    const [subscriptions, preferences] = await Promise.all([
      prisma.userCompanySubscription.findMany({
        where: { userId: request.userId, active: true },
        select: { companyId: true },
      }),
      prisma.userPreferences.findUnique({ where: { userId: request.userId }, select: PREFERENCES_SELECT }),
    ]);

    if (subscriptions.length === 0) {
      return reply.send({ jobs: [], nextCursor: null, total: 0, unfilteredTotal: 0, filtered: false });
    }

    const where = {
      status: "ACTIVE" as const,
      companyId: { in: subscriptions.map((s) => s.companyId) },
    };

    const [allJobs, unfilteredTotal] = await Promise.all([
      prisma.job.findMany({ where, select: JOB_SELECT }),
      prisma.job.count({ where }),
    ]);

    const preferenceMatched = preferences
      ? allJobs.filter((job) => matchesPreferences(job as MatchableJob, preferences as MatchablePreferences))
      : allJobs;

    const companySlugs = query.companies
      ? new Set(
          query.companies
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : null;
    const roleFamilyFilter = query.roleFamily?.toLowerCase();
    const levelFilter = query.level?.toLowerCase();
    const locationFilter = query.location?.toLowerCase();
    const q = query.q?.toLowerCase();

    const filtered = preferenceMatched.filter((job) => {
      if (companySlugs && !companySlugs.has(job.company.slug)) return false;
      if (roleFamilyFilter && !(job.roleFamily ?? "").toLowerCase().includes(roleFamilyFilter)) return false;
      if (levelFilter && (job.level ?? "").toLowerCase() !== levelFilter) return false;
      if (query.workMode && job.workMode !== query.workMode) return false;
      if (query.opportunityType && job.opportunityType !== query.opportunityType) return false;
      if (locationFilter && !(job.location ?? "").toLowerCase().includes(locationFilter)) return false;
      if (
        q &&
        !job.title.toLowerCase().includes(q) &&
        !job.company.name.toLowerCase().includes(q) &&
        !(job.location ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const diff = sortKey(b, query.sort) - sortKey(a, query.sort);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = filtered.findIndex((j) => j.id === query.cursor);
      // An unrecognized cursor (the referenced job fell out of the filtered
      // set since the previous page -- closed, or no longer matching a
      // preference change) starts over from the top rather than erroring;
      // a page glitch is a better failure mode than a broken "load more."
      startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
    }

    const page = filtered.slice(startIndex, startIndex + query.limit);
    const nextCursor = startIndex + query.limit < filtered.length ? page[page.length - 1]?.id ?? null : null;

    const jobs = page.map((job) => {
      const matchExplanation = preferences
        ? getMatchExplanation(job as MatchableJob, preferences as MatchablePreferences)
        : null;
      const { status: _status, lastMatchRelevantChangeAt: _lmrca, ...rest } = job;
      return { ...rest, matchExplanation };
    });

    return reply.send({
      jobs,
      nextCursor,
      total: filtered.length,
      unfilteredTotal,
      filtered: preferences !== null,
    });
  });

  fastify.get<{ Params: { id: string } }>("/:id", { preHandler: requireAuth }, async (request, reply) => {
    const job = await prisma.job.findUnique({
      where: { id: request.params.id },
      select: {
        ...JOB_SELECT,
        description: true,
        company: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    // Every authenticated user can view any job's detail page -- jobs
    // aren't private data, unlike preferences/subscriptions/notifications
    // (see account & subscriptions routes for those boundaries). Only the
    // match-explanation portion is user-specific, computed fresh against
    // THIS requester's own preferences, never another user's.
    const preferences = await prisma.userPreferences.findUnique({
      where: { userId: request.userId },
      select: PREFERENCES_SELECT,
    });

    return reply.send({
      job: {
        ...job,
        // Reuses the same html->text conversion the classifier itself runs
        // on this field (see sources/classify.ts) -- description is stored
        // as HTML whose tags are themselves entity-escaped (a real
        // Greenhouse/Lever quirk, confirmed against live data), and
        // rendering that with dangerouslySetInnerHTML on the frontend would
        // mean trusting unsanitized third-party HTML. Converting to plain
        // text here is XSS-safe by construction: the client only ever
        // receives text content, never markup.
        description: htmlToText(job.description),
        matchExplanation: preferences
          ? getMatchExplanation(job as MatchableJob, preferences as MatchablePreferences)
          : null,
      },
    });
  });
}
