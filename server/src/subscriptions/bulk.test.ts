// Exercises POST /api/subscriptions/bulk through a real Fastify instance.
//
// The interesting cases are not "does it write rows" but the two guarantees
// a bulk write could quietly break:
//
//   1. A company whose baseline hasn't committed must never be subscribed,
//      or its entire back catalogue reads as new openings for that user.
//   2. Re-running "watch all" must NOT move subscribedAt on a row that is
//      already active. That timestamp is the no-flood cutoff, and pushing
//      it forward would silently discard every job discovered since the
//      original subscribe: alerts the user was already owed.
//
// Auth is stubbed the same way preferences/routes.test.ts does it.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { subscriptionRoutes } from "./routes.js";
import { setUserResolverForTesting } from "../auth/authenticate.js";

let app: FastifyInstance;
let userId: string;
let authHeaders: Record<string, string>;
let baselinedSlugs: string[];
let unbaselinedSlug: string;
const createdCompanyIds: string[] = [];

async function makeCompany(slug: string, baselined: boolean): Promise<string> {
  const company = await prisma.company.create({
    data: { name: `Bulk ${slug}`, slug, accessBasis: "OFFICIAL_API" },
  });
  createdCompanyIds.push(company.id);
  await prisma.jobSource.create({
    data: {
      companyId: company.id,
      platform: "GREENHOUSE",
      config: { boardToken: "x" },
      // A company only becomes selectable once every source has a baseline.
      initialSyncCompletedAt: baselined ? new Date() : null,
    },
  });
  return company.id;
}

function bulk(action: "watch" | "unwatch", companySlugs: string[]) {
  return app.inject({
    method: "POST",
    url: "/bulk",
    headers: authHeaders,
    payload: { action, companySlugs },
  });
}

describe("POST /api/subscriptions/bulk", () => {
  before(async () => {
    setUserResolverForTesting((request) => (request.headers["x-test-user-id"] as string) ?? null);

    app = Fastify();
    await app.register(subscriptionRoutes);
    await app.ready();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: { name: "Bulk Sub Test", email: `bulk-${suffix}@example.test`, clerkUserId: `clerk-bulk-${suffix}` },
    });
    userId = user.id;
    authHeaders = { "x-test-user-id": userId };

    baselinedSlugs = [`bulk-a-${suffix}`, `bulk-b-${suffix}`, `bulk-c-${suffix}`];
    for (const slug of baselinedSlugs) await makeCompany(slug, true);

    unbaselinedSlug = `bulk-unbaselined-${suffix}`;
    await makeCompany(unbaselinedSlug, false);
  });

  after(async () => {
    await prisma.userCompanySubscription.deleteMany({ where: { userId } });
    await prisma.jobSource.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    setUserResolverForTesting(undefined);
    await app.close();
  });

  it("watches every selectable company in one request", async () => {
    const res = await bulk("watch", baselinedSlugs);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().changed, 3);

    const active = await prisma.userCompanySubscription.count({ where: { userId, active: true } });
    assert.equal(active, 3);
  });

  it("is idempotent: watching again changes nothing and reports 0", async () => {
    const res = await bulk("watch", baselinedSlugs);
    assert.equal(res.json().changed, 0);
    assert.equal(await prisma.userCompanySubscription.count({ where: { userId, active: true } }), 3);
  });

  it("never moves subscribedAt on an already-active row", async () => {
    const before = await prisma.userCompanySubscription.findMany({
      where: { userId },
      select: { companyId: true, subscribedAt: true },
      orderBy: { companyId: "asc" },
    });

    await new Promise((r) => setTimeout(r, 15));
    await bulk("watch", baselinedSlugs);

    const after = await prisma.userCompanySubscription.findMany({
      where: { userId },
      select: { companyId: true, subscribedAt: true },
      orderBy: { companyId: "asc" },
    });

    // Pushing this forward would silently drop every job discovered since
    // the original subscribe, so it has to be byte-identical.
    assert.deepEqual(
      after.map((r) => r.subscribedAt.getTime()),
      before.map((r) => r.subscribedAt.getTime()),
    );
  });

  it("refuses to subscribe a company whose baseline hasn't committed", async () => {
    const res = await bulk("watch", [unbaselinedSlug]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().changed, 0);

    const company = await prisma.company.findUniqueOrThrow({ where: { slug: unbaselinedSlug } });
    const sub = await prisma.userCompanySubscription.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });
    assert.equal(sub, null);
  });

  it("unwatches everything in one request", async () => {
    const res = await bulk("unwatch", baselinedSlugs);
    assert.equal(res.json().changed, 3);
    assert.equal(await prisma.userCompanySubscription.count({ where: { userId, active: true } }), 0);
  });

  it("resets subscribedAt when reactivating, preserving the no-flood rule across a gap", async () => {
    const deactivated = await prisma.userCompanySubscription.findFirstOrThrow({
      where: { userId },
      select: { id: true, subscribedAt: true },
    });

    await new Promise((r) => setTimeout(r, 15));
    const res = await bulk("watch", baselinedSlugs);
    assert.equal(res.json().changed, 3);

    const reactivated = await prisma.userCompanySubscription.findUniqueOrThrow({
      where: { id: deactivated.id },
    });
    assert.equal(reactivated.active, true);
    assert.equal(reactivated.deactivatedAt, null);
    // Opposite of the already-active case: a resubscribe after a gap MUST
    // move the cutoff, or roles opened during the gap would arrive as if
    // they were new.
    assert.ok(reactivated.subscribedAt.getTime() > deactivated.subscribedAt.getTime());
  });

  it("rejects a malformed body rather than acting on a partial one", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/bulk",
      headers: authHeaders,
      payload: { action: "delete-everything", companySlugs: baselinedSlugs },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "Invalid input");
  });
});
