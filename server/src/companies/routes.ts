import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { SELECTABLE_COMPANY } from "./selectable.js";

// Read-only. Only companies whose sources all have a committed baseline
// appear here -- see selectable.ts for why that gate exists.
export async function companyRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_request, reply) => {
    const [companies, openCounts] = await Promise.all([
      prisma.company.findMany({
        where: SELECTABLE_COMPANY,
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      }),
      prisma.job.groupBy({ by: ["companyId"], where: { status: "ACTIVE" }, _count: true }),
    ]);

    const openCountByCompany = new Map(openCounts.map((c) => [c.companyId, c._count]));
    const withCounts = companies.map((c) => ({ ...c, openRoles: openCountByCompany.get(c.id) ?? 0 }));

    return reply.send({ companies: withCounts });
  });
}
