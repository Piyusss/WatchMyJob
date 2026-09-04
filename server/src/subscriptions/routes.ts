import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { SELECTABLE_COMPANY } from "../companies/selectable.js";

const subscribeSchema = z.object({
  companySlug: z.string().trim().min(1),
});

export async function subscriptionRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const subscriptions = await prisma.userCompanySubscription.findMany({
      where: { userId: request.userId },
      include: { company: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { company: { name: "asc" } },
    });

    return reply.send({ subscriptions });
  });

  fastify.post("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "companySlug is required" });
    }

    // Enforced here too, not just by the listing endpoint: a client that
    // guesses a slug must not be able to subscribe to a company whose
    // baseline hasn't committed, or its whole back catalogue would read as
    // new openings for this user.
    const company = await prisma.company.findFirst({
      where: { slug: parsed.data.companySlug, ...SELECTABLE_COMPANY },
    });
    if (!company) {
      return reply.code(404).send({ error: "No such company" });
    }

    const userId = request.userId!;
    const existing = await prisma.userCompanySubscription.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });

    // Already watching this company -- idempotent no-op rather than an error,
    // so a toggle UI never has to special-case "already subscribed".
    if (existing?.active) {
      return reply.send({ subscription: existing });
    }

    // First-time subscribe, or reactivating after a prior unsubscribe:
    // subscribedAt resets to now() either way. On reactivation this is the
    // only policy that preserves the no-flood guarantee across the gap --
    // see Section 6's rule, applied here to the resubscribe case.
    const subscription = await prisma.userCompanySubscription.upsert({
      where: { userId_companyId: { userId, companyId: company.id } },
      create: { userId, companyId: company.id },
      update: { active: true, subscribedAt: new Date(), deactivatedAt: null },
    });

    return reply.code(existing ? 200 : 201).send({ subscription });
  });

  fastify.delete("/:slug", { preHandler: requireAuth }, async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const company = await prisma.company.findUnique({ where: { slug } });
    if (!company) {
      return reply.code(404).send({ error: "No such company" });
    }

    const userId = request.userId!;
    const existing = await prisma.userCompanySubscription.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });

    if (!existing || !existing.active) {
      // Nothing to do -- unsubscribing twice is not an error.
      return reply.send({ subscription: existing ?? null });
    }

    const subscription = await prisma.userCompanySubscription.update({
      where: { userId_companyId: { userId, companyId: company.id } },
      data: { active: false, deactivatedAt: new Date() },
    });

    return reply.send({ subscription });
  });
}
