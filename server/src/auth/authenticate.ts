import type { FastifyReply, FastifyRequest } from "fastify";
import { getAuth } from "@clerk/fastify";
import { clerkClient } from "./clerkClient.js";
import { prisma } from "../db/prisma.js";
import type { User } from "@prisma/client";

// Test-only seam, mirroring email/index.ts's setEmailProviderForTesting --
// lets a test authenticate as a known local user without a real Clerk
// session token (and without registering clerkPlugin at all). Never used
// from production code.
type TestResolver = (request: FastifyRequest) => string | null;
let testResolver: TestResolver | undefined;

export function setUserResolverForTesting(fn: TestResolver | undefined): void {
  testResolver = fn;
}

function primaryEmail(clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>) {
  return clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId);
}

function displayName(clerkUser: Awaited<ReturnType<typeof clerkClient.users.getUser>>, fallbackEmail: string) {
  const parts = [clerkUser.firstName, clerkUser.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (clerkUser.username) return clerkUser.username;
  return fallbackEmail;
}

// Lazily provisions the local User row the first time a given Clerk
// identity is seen -- no webhook required (a user.created webhook would
// need a public URL for Clerk to call, which local dev doesn't have). One
// Clerk API call, on first sign-in only; every request after this finds
// the row by clerkUserId directly.
async function resolveLocalUser(clerkUserId: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = primaryEmail(clerkUser);
  if (!email) {
    throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
  }

  // Two requests racing to provision the same brand-new user both pass the
  // findUnique check above (neither sees the other's row yet); the unique
  // constraint on clerkUserId turns the loser into a P2002 error, which we
  // then just re-read rather than treating as a real failure.
  try {
    return await prisma.user.create({
      data: {
        clerkUserId,
        email: email.emailAddress,
        name: displayName(clerkUser, email.emailAddress),
        emailVerified: email.verification?.status === "verified",
      },
    });
  } catch (err) {
    const retry = await prisma.user.findUnique({ where: { clerkUserId } });
    if (retry) return retry;
    throw err;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  // Test mode: the resolver hands back the LOCAL user id directly (tests
  // already have one, from creating the fixture) -- Clerk is never
  // consulted, so no network call and no clerkPlugin registration needed.
  if (testResolver) {
    const userId = testResolver(request);
    if (!userId) {
      reply.code(401).send({ error: "Not authenticated" });
      return reply;
    }
    request.userId = userId;
    return;
  }

  const clerkUserId = getAuth(request).userId;
  if (!clerkUserId) {
    reply.code(401).send({ error: "Not authenticated" });
    return reply;
  }

  const user = await resolveLocalUser(clerkUserId);
  request.userId = user.id;
  request.clerkUserId = clerkUserId;
}
