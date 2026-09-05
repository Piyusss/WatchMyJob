import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";

const unsubscribeSchema = z.object({
  token: z.string().min(1),
});

const MAX_LIMIT = 100;

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(25),
  // Keyset pagination on createdAt, not an offset: this list grows at the
  // top, and OFFSET would silently skip or repeat rows as new notifications
  // arrive mid-scroll.
  cursor: z.string().uuid().optional(),
});

// Public, no auth: the whole point of an email unsubscribe link is that
// it works without logging in. POST, not GET: a GET link is exactly what
// an email client's link-prefetch or a security scanner fetches
// automatically (the same reasoning that kept email verification off a
// bare GET in Phase 1): the frontend page at this link's target makes
// this call deliberately, a prefetch never does.
export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.post("/unsubscribe", async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "A token is required" });
    }

    const user = await prisma.user.findUnique({ where: { unsubscribeToken: parsed.data.token } });
    if (!user) {
      return reply.code(404).send({ error: "This unsubscribe link is invalid" });
    }

    await prisma.user.update({ where: { id: user.id }, data: { notificationsPaused: true } });

    return reply.send({ notificationsPaused: true });
  });

  // The user's own notification history. A read-only record of what was
  // already sent, NOT a second delivery channel: nothing here creates,
  // retries or re-sends anything.
  //
  // Scoped to request.userId with no way to widen it: there is no userId
  // query parameter by design, so one user can never read another's history.
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    }
    const { limit, cursor } = parsed.data;

    // QUEUED rows are deliberately excluded: from the user's point of view a
    // notification that hasn't been attempted yet hasn't happened, and
    // showing it would promise an email that the pre-send recheck may still
    // correctly decide not to send.
    const where = { userId: request.userId, status: { not: "QUEUED" as const } };

    // Over-fetch by one to detect a further page without a second count query.
    const rows = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        notificationType: true,
        status: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        job: {
          select: {
            id: true,
            title: true,
            location: true,
            status: true,
            company: { select: { name: true, slug: true } },
          },
        },
      },
    });

    const page = rows.slice(0, limit);
    return reply.send({
      notifications: page,
      nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
      total: await prisma.notification.count({ where }),
    });
  });
}
