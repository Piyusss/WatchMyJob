import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { SELECTABLE_COMPANY } from "./selectable.js";

const RECENT_JOBS_LIMIT = 10;

// Classification currently produces a near-title-granular roleFamily (Figma
// alone yields ~157 distinct values across 158 open jobs), so an unfiltered
// list would be a wall of one-off labels restating job titles. Requiring a
// repeat and capping the list keeps this section to the genuine "what do
// they hire for repeatedly" signal. Coarser role families are Phase 6's
// classification work; this is the honest presentation of what exists today.
const ROLE_FAMILY_MIN_COUNT = 2;
const ROLE_FAMILY_LIMIT = 8;

// Read-only. Only companies whose sources all have a committed baseline
// appear here -- see selectable.ts for why that gate exists.
export async function companyRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_request, reply) => {
    const [companies, openCounts] = await Promise.all([
      prisma.company.findMany({
        where: SELECTABLE_COMPANY,
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, domain: true },
      }),
      prisma.job.groupBy({ by: ["companyId"], where: { status: "ACTIVE" }, _count: true }),
    ]);

    const openCountByCompany = new Map(openCounts.map((c) => [c.companyId, c._count]));
    const withCounts = companies.map((c) => ({ ...c, openRoles: openCountByCompany.get(c.id) ?? 0 }));

    return reply.send({ companies: withCounts });
  });

  // Company detail. Authenticated (unlike the list) because it reports this
  // requester's own watching state, and because "recent jobs" is the same
  // job data the rest of the authenticated surface serves.
  fastify.get<{ Params: { slug: string } }>("/:slug", { preHandler: requireAuth }, async (request, reply) => {
    const company = await prisma.company.findFirst({
      where: { ...SELECTABLE_COMPANY, slug: request.params.slug },
      select: { id: true, name: true, slug: true, status: true, domain: true },
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }

    const [openRoles, subscription, recentJobs, roleFamilies, lastSync] = await Promise.all([
      prisma.job.count({ where: { companyId: company.id, status: "ACTIVE" } }),
      prisma.userCompanySubscription.findUnique({
        where: { userId_companyId: { userId: request.userId!, companyId: company.id } },
        select: { active: true },
      }),
      prisma.job.findMany({
        where: { companyId: company.id, status: "ACTIVE" },
        orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
        take: RECENT_JOBS_LIMIT,
        select: {
          id: true,
          title: true,
          location: true,
          workMode: true,
          opportunityType: true,
          firstSeenAt: true,
          roleFamily: true,
          level: true,
        },
      }),
      prisma.job.groupBy({
        by: ["roleFamily"],
        where: { companyId: company.id, status: "ACTIVE", roleFamily: { not: null } },
        _count: true,
      }),
      // "Last data update" means the last time a sync of this company's
      // sources actually SUCCEEDED -- a failing source must not be able to
      // present itself as freshly updated.
      prisma.jobSource.aggregate({
        where: { companyId: company.id },
        _max: { lastSuccessAt: true },
      }),
    ]);

    return reply.send({
      company: {
        ...company,
        openRoles,
        // A row with active:false is an unsubscribed history record, not a
        // subscription -- both read as "not watching".
        watching: subscription?.active === true,
        lastSyncedAt: lastSync._max.lastSuccessAt,
        roleFamilies: roleFamilies
          .map((r) => ({ roleFamily: r.roleFamily as string, count: r._count }))
          .filter((r) => r.count >= ROLE_FAMILY_MIN_COUNT)
          .sort((a, b) => b.count - a.count || a.roleFamily.localeCompare(b.roleFamily))
          .slice(0, ROLE_FAMILY_LIMIT),
        recentJobs,
      },
    });
  });
}
