import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

const unsubscribeSchema = z.object({
  token: z.string().min(1),
});

// Public, no auth -- the whole point of an email unsubscribe link is that
// it works without logging in. POST, not GET: a GET link is exactly what
// an email client's link-prefetch or a security scanner fetches
// automatically (the same reasoning that kept email verification off a
// bare GET in Phase 1) -- the frontend page at this link's target makes
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
}
