import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { requireAuth, isAdminEmail } from "./authenticate.js";

function toPublicUser(
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    notificationsPaused: boolean;
    createdAt: Date;
  },
  hasPreferences: boolean,
) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    notificationsPaused: user.notificationsPaused,
    createdAt: user.createdAt,
    // Drives the frontend's onboarding redirect: the matching engine
    // already refuses to queue notifications for a user with no saved
    // UserPreferences row (see matching/engine.ts), so this just surfaces
    // that same fact to the UI instead of leaving it silent.
    hasPreferences,
    // Drives whether AuthNav shows the admin/test-companies link. Purely a
    // UI convenience: the actual boundary is requireAdmin on the server,
    // checked fresh on every admin request, not trusted from this field.
    isAdmin: isAdminEmail(user.email),
  };
}

async function checkHasPreferences(userId: string): Promise<boolean> {
  const preferences = await prisma.userPreferences.findUnique({ where: { userId }, select: { userId: true } });
  return preferences !== null;
}

// Registration, login, logout, email verification and password reset are
// all Clerk's now (see web/src/app/login and /register, and proxy.ts):
// this file only surfaces the JobDrop-specific profile fields once Clerk
// has already authenticated the request.
export async function authRoutes(fastify: FastifyInstance) {
  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      return reply.code(401).send({ error: "Not authenticated" });
    }
    return reply.send({ user: toPublicUser(user, await checkHasPreferences(user.id)) });
  });
}
