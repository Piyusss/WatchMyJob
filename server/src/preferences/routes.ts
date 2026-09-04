import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { preferencesSchema, type PreferencesInput } from "./schemas.js";
import { matchUserAgainstActiveJobs } from "../matching/engine.js";

const SCALAR_FIELDS = ["roleFamily", "roleLevel", "yearsExperience", "toleranceYears", "country", "state", "city"] as const;

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function isMatchingRelevantChange(
  existing: {
    roleFamily: string | null;
    roleLevel: string | null;
    yearsExperience: number | null;
    toleranceYears: number | null;
    country: string | null;
    state: string | null;
    city: string | null;
    workMode: string[];
    opportunityTypes: string[];
  } | null,
  input: PreferencesInput,
): boolean {
  if (!existing) return true;
  for (const field of SCALAR_FIELDS) {
    if (existing[field] !== (input[field] ?? null)) return true;
  }
  if (!sameSet(existing.workMode, input.workMode)) return true;
  if (!sameSet(existing.opportunityTypes, input.opportunityTypes)) return true;
  return false;
}

export async function preferencesRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const preferences = await prisma.userPreferences.findUnique({ where: { userId: request.userId } });
    return reply.send({ preferences });
  });

  fastify.put("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const userId = request.userId!;
    const input = parsed.data;

    const existing = await prisma.userPreferences.findUnique({ where: { userId } });
    const changed = isMatchingRelevantChange(existing, input);

    const data = {
      roleFamily: input.roleFamily ?? null,
      roleLevel: input.roleLevel ?? null,
      yearsExperience: input.yearsExperience ?? null,
      toleranceYears: input.toleranceYears ?? null,
      country: input.country ?? null,
      state: input.state ?? null,
      city: input.city ?? null,
      workMode: input.workMode,
      opportunityTypes: input.opportunityTypes,
    };

    const preferences = await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: changed ? { ...data, effectiveSince: new Date() } : data,
    });

    // Only worth re-running when something matching-relevant actually
    // changed -- an unchanged resubmission can't newly match anything, and
    // effectiveSince didn't move, so the eligibility check would find
    // nothing new either. Never lets a matching-engine failure fail the
    // save itself: the preferences ARE correctly persisted regardless.
    if (changed) {
      try {
        await matchUserAgainstActiveJobs(userId);
      } catch (err) {
        request.log.error({ err, userId }, "matchUserAgainstActiveJobs failed after a preference change");
      }
    }

    return reply.send({ preferences });
  });
}
