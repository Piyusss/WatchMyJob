import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../auth/authenticate.js";
import { findCountry, findState } from "../geo/data.js";
import { preferencesSchema, type PreferencesInput, type LocationInput } from "./schemas.js";
import { matchUserAgainstActiveJobs } from "../matching/engine.js";

const SCALAR_FIELDS = ["roleFamily", "roleLevel", "yearsExperience", "toleranceYears"] as const;

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// One string per location so set-equality can reuse sameSet -- order never
// matters for either preferences (workMode/opportunityTypes) or locations.
function locationKey(loc: { countryCode: string; stateCode: string | null; cityName: string | null }): string {
  return `${loc.countryCode}|${loc.stateCode ?? ""}|${loc.cityName ?? ""}`;
}

function isMatchingRelevantChange(
  existing: {
    roleFamily: string | null;
    roleLevel: string | null;
    yearsExperience: number | null;
    toleranceYears: number | null;
    workMode: string[];
    opportunityTypes: string[];
    locations: { countryCode: string; stateCode: string | null; cityName: string | null }[];
  } | null,
  input: PreferencesInput,
): boolean {
  if (!existing) return true;
  for (const field of SCALAR_FIELDS) {
    if (existing[field] !== (input[field] ?? null)) return true;
  }
  if (!sameSet(existing.workMode, input.workMode)) return true;
  if (!sameSet(existing.opportunityTypes, input.opportunityTypes)) return true;
  if (!sameSet(existing.locations.map(locationKey), input.locations.map(locationKey))) return true;
  return false;
}

// Derives the denormalized display names from the validated codes -- see
// schema.prisma's UserPreferenceLocation comment for why matching needs
// names (substring match against a job's raw location text) even though the
// wire format and validation are code-based.
function toLocationRow(loc: LocationInput) {
  const country = findCountry(loc.countryCode)!; // already validated by preferencesSchema
  const state = loc.stateCode ? findState(loc.countryCode, loc.stateCode) : undefined;
  return {
    countryCode: country.code,
    countryName: country.name,
    stateCode: state?.code ?? null,
    stateName: state?.name ?? null,
    cityName: loc.cityName,
  };
}

const PREFERENCES_INCLUDE = { locations: true } as const;

export async function preferencesRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: requireAuth }, async (request, reply) => {
    const preferences = await prisma.userPreferences.findUnique({
      where: { userId: request.userId },
      include: PREFERENCES_INCLUDE,
    });
    return reply.send({ preferences });
  });

  fastify.put("/", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const userId = request.userId!;
    const input = parsed.data;

    // roleFamily has no fixed taxonomy to validate against statically (see
    // jobs/routes.ts's /role-families comment) -- "controlled selection, not
    // free text" here means it must be a value that's actually on a real
    // active job right now, checked live against the database rather than a
    // list that would drift from reality.
    if (input.roleFamily !== null) {
      const exists = await prisma.job.findFirst({
        where: { status: "ACTIVE", roleFamily: input.roleFamily },
        select: { id: true },
      });
      if (!exists) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: { roleFamily: ["Not a currently available role"] } });
      }
    }

    const existing = await prisma.userPreferences.findUnique({
      where: { userId },
      include: PREFERENCES_INCLUDE,
    });
    const changed = isMatchingRelevantChange(existing, input);

    const locationRows = input.locations.map(toLocationRow);
    const scalarData = {
      roleFamily: input.roleFamily ?? null,
      roleLevel: input.roleLevel ?? null,
      yearsExperience: input.yearsExperience ?? null,
      toleranceYears: input.toleranceYears ?? null,
      workMode: input.workMode,
      opportunityTypes: input.opportunityTypes,
    };

    const preferences = await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...scalarData, locations: { create: locationRows } },
      update: {
        ...scalarData,
        ...(changed ? { effectiveSince: new Date() } : {}),
        // Full replace, not a diff -- the form always submits the complete
        // current list, so clearing and recreating is both simpler and
        // correct (a partial add/remove API would need its own id-based
        // contract the frontend has no reason to carry).
        locations: { deleteMany: {}, create: locationRows },
      },
      include: PREFERENCES_INCLUDE,
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
