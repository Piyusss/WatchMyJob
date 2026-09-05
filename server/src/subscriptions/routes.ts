import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { SELECTABLE_COMPANY } from "../companies/selectable.js";

const subscribeSchema = z.object({
  companySlug: z.string().trim().min(1),
});

// Watch/unwatch a set in one request. Exists because the UI's "Watch all"
// covers every selectable company, and firing that many single-slug
// requests would be a round trip per company for one user gesture.
//
// Slugs are always explicit, never an implicit "everything": the client
// sends exactly the list it showed the user, so a filtered view acts on
// what was on screen rather than silently on the whole catalogue.
const bulkSchema = z.object({
  action: z.enum(["watch", "unwatch"]),
  companySlugs: z.array(z.string().trim().min(1)).min(1).max(500),
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

    // Already watching this company: idempotent no-op rather than an error,
    // so a toggle UI never has to special-case "already subscribed".
    if (existing?.active) {
      return reply.send({ subscription: existing });
    }

    // First-time subscribe, or reactivating after a prior unsubscribe:
    // subscribedAt resets to now() either way. On reactivation this is the
    // only policy that preserves the no-flood guarantee across the gap:
    // see Section 6's rule, applied here to the resubscribe case.
    const subscription = await prisma.userCompanySubscription.upsert({
      where: { userId_companyId: { userId, companyId: company.id } },
      create: { userId, companyId: company.id },
      update: { active: true, subscribedAt: new Date(), deactivatedAt: null },
    });

    return reply.code(existing ? 200 : 201).send({ subscription });
  });

  fastify.post("/bulk", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = bulkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const userId = request.userId!;
    const { action, companySlugs } = parsed.data;

    // SELECTABLE_COMPANY applies here exactly as it does to the single
    // subscribe: a slug whose baseline hasn't committed is silently dropped
    // rather than subscribed, so no bulk action can hand someone a
    // company's whole back catalogue as new openings.
    const companies = await prisma.company.findMany({
      where: { slug: { in: companySlugs }, ...SELECTABLE_COMPANY },
      select: { id: true },
    });
    const companyIds = companies.map((c) => c.id);

    if (companyIds.length === 0) {
      return reply.send({ changed: 0 });
    }

    if (action === "unwatch") {
      const { count } = await prisma.userCompanySubscription.updateMany({
        where: { userId, companyId: { in: companyIds }, active: true },
        data: { active: false, deactivatedAt: new Date() },
      });
      return reply.send({ changed: count });
    }

    // Two statements rather than one upsert per company, in a transaction so
    // the pair is atomic.
    const changed = await prisma.$transaction(async (tx) => {
      // Rows that don't exist yet. `active` and `subscribedAt` take their
      // schema defaults (true, now()), which is exactly right for a first
      // subscribe.
      const created = await tx.userCompanySubscription.createMany({
        data: companyIds.map((companyId) => ({ userId, companyId })),
        skipDuplicates: true,
      });

      // Reactivations only. Restricted to active:false deliberately: an
      // already-active row must keep its original subscribedAt, because
      // moving that cutoff forward would silently discard every job
      // discovered between the old value and now, i.e. skip alerts the user
      // was already owed.
      const reactivated = await tx.userCompanySubscription.updateMany({
        where: { userId, companyId: { in: companyIds }, active: false },
        data: { active: true, subscribedAt: new Date(), deactivatedAt: null },
      });

      return created.count + reactivated.count;
    });

    return reply.send({ changed });
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
      // Nothing to do: unsubscribing twice is not an error.
      return reply.send({ subscription: existing ?? null });
    }

    const subscription = await prisma.userCompanySubscription.update({
      where: { userId_companyId: { userId, companyId: company.id } },
      data: { active: false, deactivatedAt: new Date() },
    });

    return reply.send({ subscription });
  });
}
