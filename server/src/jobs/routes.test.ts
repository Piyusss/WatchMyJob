// Exercises GET /api/jobs and GET /api/jobs/:id through a real Fastify
// instance (route registration, requireAuth's preHandler, zod query
// validation): not just the pagination/filter logic in isolation, since
// the auth wiring and query-string coercion are themselves real places to
// get wrong. Auth itself is stubbed via setUserResolverForTesting (see
// auth/authenticate.ts) rather than a real Clerk token: a request's
// x-test-user-id header stands in for whatever Clerk would have resolved.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { jobRoutes } from "./routes.js";
import { setUserResolverForTesting } from "../auth/authenticate.js";

let app: FastifyInstance;
let userId: string;
let authHeaders: Record<string, string>;
let companyId: string;
let sourceId: string;

interface JobOverrides {
  title?: string;
  description?: string;
  roleFamily?: string;
}

async function makeJob(overrides: JobOverrides = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.job.create({
    data: {
      companyId,
      sourceId,
      externalJobId: suffix,
      identityHash: suffix,
      contentHash: suffix,
      title: "Software Engineer",
      sourceUrl: `https://example.test/${suffix}`,
      opportunityType: "FULL_TIME",
      ...overrides,
    },
  });
}

describe("GET /api/jobs and /api/jobs/:id", () => {
  before(async () => {
    setUserResolverForTesting((request) => (request.headers["x-test-user-id"] as string) ?? null);

    app = Fastify();
    await app.register(jobRoutes);
    await app.ready();

    const suffix = Date.now();
    const user = await prisma.user.create({
      data: { name: "Jobs Route Test", email: `jobs-route-${suffix}@example.test`, clerkUserId: `clerk-jobs-${suffix}` },
    });
    userId = user.id;
    authHeaders = { "x-test-user-id": userId };

    const company = await prisma.company.create({
      data: { name: "Jobs Route Co", slug: `jobs-route-co-${suffix}`, accessBasis: "OFFICIAL_API" },
    });
    companyId = company.id;
    const source = await prisma.jobSource.create({
      data: { companyId, platform: "GREENHOUSE", config: { boardToken: "x" } },
    });
    sourceId = source.id;

    await prisma.userCompanySubscription.create({ data: { userId, companyId } });
  });

  after(async () => {
    setUserResolverForTesting(undefined);
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("returns an empty result with no active user error when the user has no subscriptions", async () => {
    const otherUser = await prisma.user.create({
      data: { name: "No Subs", email: `no-subs-${Date.now()}@example.test`, clerkUserId: `clerk-no-subs-${Date.now()}` },
    });
    const res = await app.inject({
      method: "GET",
      url: "/",
      headers: { "x-test-user-id": otherUser.id },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { jobs: [], nextCursor: null, total: 0, unfilteredTotal: 0, filtered: false });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("rejects a request with no auth", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 401);
  });

  it("paginates with a stable cursor across pages, covering every job exactly once", async () => {
    const created = [];
    for (let i = 0; i < 5; i++) created.push(await makeJob({ title: `Pagination Job ${i}` }));

    const seenIds = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await app.inject({
        method: "GET",
        url: `/?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        headers: authHeaders,
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      for (const j of body.jobs) {
        assert.equal(seenIds.has(j.id), false, "no job should ever repeat across pages");
        if (created.some((c) => c.id === j.id)) seenIds.add(j.id);
      }
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    for (const j of created) assert.ok(seenIds.has(j.id), `job ${j.title} should have appeared on some page`);
  });

  it("validates query parameters and rejects an invalid one with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/?limit=9999", headers: authHeaders });
    assert.equal(res.statusCode, 400);
  });

  it("filters by company slug", async () => {
    const otherCompany = await prisma.company.create({
      data: { name: "Other Co", slug: `other-co-${Date.now()}`, accessBasis: "OFFICIAL_API" },
    });
    const otherSource = await prisma.jobSource.create({
      data: { companyId: otherCompany.id, platform: "GREENHOUSE", config: { boardToken: "y" } },
    });
    await prisma.userCompanySubscription.create({ data: { userId, companyId: otherCompany.id } });
    await prisma.job.create({
      data: {
        companyId: otherCompany.id,
        sourceId: otherSource.id,
        externalJobId: "other-1",
        identityHash: "other-1",
        contentHash: "other-1",
        title: "Should Not Appear",
        sourceUrl: "https://example.test/other-1",
      },
    });
    await makeJob({ title: "Should Appear" });

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const filteredRes = await app.inject({
      method: "GET",
      url: `/?companies=${company.slug}&limit=100`,
      headers: authHeaders,
    });
    const body = filteredRes.json();
    assert.ok(body.jobs.every((j: { company: { slug: string } }) => j.company.slug === company.slug));
    assert.ok(!body.jobs.some((j: { title: string }) => j.title === "Should Not Appear"));

    await prisma.company.delete({ where: { id: otherCompany.id } });
  });

  it("filters by free-text search across title/company/location", async () => {
    await makeJob({ title: "Extremely Unique Searchable Title" });
    const res = await app.inject({
      method: "GET",
      url: "/?q=Extremely Unique Searchable",
      headers: authHeaders,
    });
    const body = res.json();
    assert.ok(body.jobs.length >= 1);
    assert.ok(body.jobs.every((j: { title: string }) => j.title.includes("Extremely Unique Searchable")));
  });

  it("includes a matchExplanation per job only when the user has saved preferences", async () => {
    const job = await makeJob({ title: "Match Explanation Test", roleFamily: "Software Engineer" });

    const before = await app.inject({ method: "GET", url: `/?q=Match Explanation Test`, headers: authHeaders });
    assert.equal(before.json().filtered, false);
    assert.equal(before.json().jobs[0].matchExplanation, null);

    await prisma.userPreferences.create({ data: { userId, roleFamily: "Software Engineer" } });
    const after = await app.inject({ method: "GET", url: `/?q=Match Explanation Test`, headers: authHeaders });
    assert.equal(after.json().filtered, true);
    assert.ok(after.json().jobs.length >= 1);
    assert.equal(after.json().jobs[0].matchExplanation.roleMatched, true);

    await prisma.userPreferences.delete({ where: { userId } });
    await prisma.job.delete({ where: { id: job.id } });
  });

  it("GET /:id returns 404 for a nonexistent job", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/00000000-0000-0000-0000-000000000000",
      headers: authHeaders,
    });
    assert.equal(res.statusCode, 404);
  });

  it("GET /:id returns full job detail including description and matchExplanation", async () => {
    const job = await makeJob({ title: "Detail Page Job", description: "Full description text" });
    const res = await app.inject({ method: "GET", url: `/${job.id}`, headers: authHeaders });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.job.title, "Detail Page Job");
    assert.equal(body.job.description, "Full description text");
    assert.equal(body.job.company.slug !== undefined, true);
  });
});
