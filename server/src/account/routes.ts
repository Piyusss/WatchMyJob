import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clerkClient } from "../auth/clerkClient.js";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";

const notificationsSchema = z.object({
  paused: z.boolean(),
});

export async function accountRoutes(fastify: FastifyInstance) {
  // Everything this user's account holds, in one JSON document -- the
  // baseline "self-service export" a product collecting this much profile
  // and preference data should offer, without building a compliance
  // department around it.
  fastify.get("/export", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    const [user, preferences, subscriptions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          phone: true,
          linkedinUrl: true,
          githubUrl: true,
          notificationsPaused: true,
          createdAt: true,
        },
      }),
      prisma.userPreferences.findUnique({ where: { userId } }),
      prisma.userCompanySubscription.findMany({
        where: { userId },
        include: { company: { select: { name: true, slug: true } } },
      }),
    ]);

    if (!user) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    return reply.send({
      exportedAt: new Date().toISOString(),
      user,
      preferences,
      subscriptions,
    });
  });

  // The in-app side of pausing/resuming notifications. The email-link side
  // (no login required, for the unsubscribe link every notification
  // carries) is notifications/routes.ts -- both ultimately just flip this
  // same field.
  fastify.patch("/notifications", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = notificationsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "paused (boolean) is required" });
    }

    const user = await prisma.user.update({
      where: { id: request.userId },
      data: { notificationsPaused: parsed.data.paused },
      select: { notificationsPaused: true },
    });

    return reply.send(user);
  });

  fastify.delete("/", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user || !request.clerkUserId) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    // Clerk owns the actual account; deleting only the local row would let
    // it silently reappear (see resolveLocalUser in auth/authenticate.ts,
    // which recreates it on the very next authenticated request). Delete
    // the Clerk account first: if this fails, nothing local has changed
    // yet, so the request can just be retried.
    await clerkClient.users.deleteUser(request.clerkUserId);

    // Cascades to preferences and subscriptions -- both declared
    // onDelete: Cascade in the schema.
    await prisma.user.delete({ where: { id: user.id } });

    return reply.code(204).send();
  });
}
