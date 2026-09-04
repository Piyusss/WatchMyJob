import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { requireAuth } from "../auth/authenticate.js";
import { verifyPassword } from "../auth/password.js";

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

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
    const parsed = deleteAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Password is required to delete your account" });
    }

    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Incorrect password" });
    }

    // Cascades to preferences, subscriptions, and verification tokens --
    // all declared onDelete: Cascade in the schema.
    await prisma.user.delete({ where: { id: user.id } });

    reply.clearCookie(env.COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });
}
