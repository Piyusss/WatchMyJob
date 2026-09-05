// Exercises PUT/GET /api/preferences through a real Fastify instance:
// specifically the validation this route adds on top of the zod shape
// check: a roleLevel outside the fixed enum, a roleFamily that isn't on any
// real active job, and a location whose state doesn't belong to its
// claimed country all have to come back as 400s, not silently accepted or
// silently dropped. Auth is stubbed the same way jobs/routes.test.ts does
// it: see that file's header comment for why.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { preferencesRoutes } from "./routes.js";
import { setUserResolverForTesting } from "../auth/authenticate.js";

let app: FastifyInstance;
let userId: string;
let authHeaders: Record<string, string>;
let companyId: string;
let sourceId: string;

describe("PUT/GET /api/preferences", () => {
  before(async () => {
    setUserResolverForTesting((request) => (request.headers["x-test-user-id"] as string) ?? null);

    app = Fastify();
    await app.register(preferencesRoutes);
    await app.ready();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: { name: "Preferences Route Test", email: `prefs-route-${suffix}@example.test`, clerkUserId: `clerk-prefs-${suffix}` },
    });
    userId = user.id;
    authHeaders = { "x-test-user-id": userId };

    // roleFamily validation queries real ACTIVE jobs: needs one to exist
    // with a known value to validate against.
    const company = await prisma.company.create({
      data: { name: "Prefs Route Co", slug: `prefs-route-co-${suffix}`, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    sourceId = source.id;
    await prisma.job.create({
      data: {
        companyId,
        sourceId,
        externalJobId: suffix,
        identityHash: suffix,
        contentHash: suffix,
        title: "Staff Software Engineer",
        roleFamily: "Staff Software Engineer",
        sourceUrl: `https://example.test/${suffix}`,
        opportunityType: "FULL_TIME",
        status: "ACTIVE",
      },
    });
  });

  after(async () => {
    setUserResolverForTesting(undefined);
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("saves a full valid payload: role, level, multiple locations", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: {
        roleFamily: "Staff Software Engineer",
        roleLevel: "Staff",
        yearsExperience: 8,
        toleranceYears: 2,
        locations: [
          { countryCode: "IN", stateCode: "KA", cityName: "Bangalore" },
          { countryCode: "US", stateCode: "CA", cityName: null },
        ],
        workMode: ["REMOTE"],
        opportunityTypes: [],
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.preferences.roleLevel, "Staff");
    assert.equal(body.preferences.locations.length, 2);
    const bangalore = body.preferences.locations.find((l: { cityName: string | null }) => l.cityName === "Bangalore");
    assert.equal(bangalore.countryName, "India");
    assert.equal(bangalore.stateName, "Karnataka");
  });

  it("rejects a roleLevel outside the fixed vocabulary", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: { roleLevel: "Manager", locations: [], workMode: [], opportunityTypes: [] },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects a roleFamily that isn't on any real active job: no arbitrary values accepted", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: { roleFamily: "Not A Real Role Xyz", locations: [], workMode: [], opportunityTypes: [] },
    });
    assert.equal(res.statusCode, 400);
    assert.match(JSON.stringify(res.json()), /roleFamily/);
  });

  it("rejects a state that doesn't belong to the given country", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      // KA (Karnataka) belongs to India, not the US.
      payload: { locations: [{ countryCode: "US", stateCode: "KA", cityName: null }], workMode: [], opportunityTypes: [] },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects a city submitted without a state: the hierarchy is mandatory top-down", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: {
        locations: [{ countryCode: "IN", stateCode: null, cityName: "Bangalore" }],
        workMode: [],
        opportunityTypes: [],
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("a save that fully replaces the location list: old locations don't linger", async () => {
    await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: {
        locations: [
          { countryCode: "IN", stateCode: "KA", cityName: "Bangalore" },
          { countryCode: "IN", stateCode: "MH", cityName: "Pune" },
        ],
        workMode: [],
        opportunityTypes: [],
      },
    });

    const res = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: { locations: [{ countryCode: "IN", stateCode: "MH", cityName: "Pune" }], workMode: [], opportunityTypes: [] },
    });
    assert.equal(res.statusCode, 200);
    const locations = res.json().preferences.locations;
    assert.equal(locations.length, 1);
    assert.equal(locations[0].cityName, "Pune");
  });

  it("GET reflects the last successful save, including locations", async () => {
    const res = await app.inject({ method: "GET", url: "/", headers: authHeaders });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().preferences.locations.length, 1);
  });

  it("an invalid save does not overwrite the last valid state", async () => {
    // Self-contained: establish a known-good state first rather than relying
    // on residual state from earlier tests: PUT fully replaces every
    // field on every call (same convention as workMode/opportunityTypes
    // already had), so any field omitted from an intervening payload would
    // otherwise silently reset to null and produce a false pass here.
    await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: { roleLevel: "Principal", locations: [], workMode: [], opportunityTypes: [] },
    });

    const rejected = await app.inject({
      method: "PUT",
      url: "/",
      headers: authHeaders,
      payload: { roleLevel: "Not A Real Level", locations: [], workMode: [], opportunityTypes: [] },
    });
    assert.equal(rejected.statusCode, 400);

    const res = await app.inject({ method: "GET", url: "/", headers: authHeaders });
    assert.equal(res.json().preferences.roleLevel, "Principal");
  });
});
