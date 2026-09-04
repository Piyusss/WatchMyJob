import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { env, isProduction } from "../config/env.js";
import { getEmailProvider, verificationEmail } from "../email/index.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateVerificationToken, hashToken, signSession } from "./tokens.js";
import { requireAuth } from "./authenticate.js";
import { loginSchema, registerSchema, verifyEmailSchema } from "./schemas.js";

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds, matches the JWT ttl in tokens.ts

const AUTH_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

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
    // Drives the frontend's onboarding redirect -- the matching engine
    // already refuses to queue notifications for a user with no saved
    // UserPreferences row (see matching/engine.ts), so this just surfaces
    // that same fact to the UI instead of leaving it silent.
    hasPreferences,
  };
}

async function checkHasPreferences(userId: string): Promise<boolean> {
  const preferences = await prisma.userPreferences.findUnique({ where: { userId }, select: { userId: true } });
  return preferences !== null;
}

function setSessionCookie(reply: import("fastify").FastifyReply, userId: string) {
  const token = signSession({ userId });
  reply.setCookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

async function issueVerificationEmail(user: { id: string; name: string; email: string }) {
  const { raw, hash, expiresAt } = generateVerificationToken();

  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt },
  });

  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${raw}`;
  const message = verificationEmail(user.name, verifyUrl);

  try {
    await getEmailProvider().send({ to: user.email, ...message });
  } catch (err) {
    // Never block registration on a transient email-provider failure; the
    // user can request another link via /resend-verification.
    console.error("Failed to send verification email:", err);
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const { name, email, password, phone, linkedinUrl, githubUrl } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        phone: phone || null,
        linkedinUrl: linkedinUrl || null,
        githubUrl: githubUrl || null,
      },
    });

    await issueVerificationEmail(user);
    setSessionCookie(reply, user.id);

    return reply.code(201).send({ user: toPublicUser(user, false) });
  });

  fastify.post("/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const { email, password } = parsed.data;
    const genericError = { error: "Invalid email or password" };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send(genericError);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send(genericError);
    }

    setSessionCookie(reply, user.id);
    return reply.send({ user: toPublicUser(user, await checkHasPreferences(user.id)) });
  });

  fastify.post("/logout", async (_request, reply) => {
    reply.clearCookie(env.COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  fastify.get("/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      return reply.code(401).send({ error: "Not authenticated" });
    }
    return reply.send({ user: toPublicUser(user, await checkHasPreferences(user.id)) });
  });

  fastify.post("/verify-email", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "A verification token is required" });
    }

    const tokenHash = hashToken(parsed.data.token);
    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    const invalid = !record || record.usedAt || record.expiresAt < new Date();
    if (invalid) {
      return reply.code(400).send({ error: "This verification link is invalid or has expired." });
    }

    await prisma.$transaction([
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
    ]);

    return reply.send({ emailVerified: true });
  });

  fastify.post(
    "/resend-verification",
    { preHandler: requireAuth, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.userId } });
      if (!user) {
        return reply.code(401).send({ error: "Not authenticated" });
      }
      if (user.emailVerified) {
        return reply.code(400).send({ error: "Email is already verified" });
      }

      await issueVerificationEmail(user);
      return reply.send({ sent: true });
    },
  );
}
