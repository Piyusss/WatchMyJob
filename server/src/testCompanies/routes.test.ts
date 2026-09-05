// End-to-end coverage of the admin/test-companies surface (custom_company.txt
// Section 20): exercises the REAL pipeline through the REAL HTTP routes:
// create a synthetic company, create a synthetic job, publish it, and check
// what actually happened to Notification rows. Publishing calls the exact
// syncSource() a real source's scheduled sync calls (see routes.ts), so a
// bug in the shared pipeline fails these the same way it'd fail a real
// company's. Notification rows are asserted at QUEUED: proof by itself
// that nothing here sent an email directly (the notification WORKER, a
// separate process never started by this test run, is the only thing that
// would move a row past QUEUED), matching Section 14's "no admin -> email
// shortcut" rule.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { testCompanyRoutes } from "./routes.js";
import { setUserResolverForTesting, setAdminEmailsForTesting } from "../auth/authenticate.js";

const RUN_ID = `test-testco-${Date.now()}`;
const ADMIN_EMAIL = `admin-${RUN_ID}@example.test`;

let app: FastifyInstance;
let adminId: string;
let adminHeaders: Record<string, string>;
let seedRoleFamilyCompanyId: string;
let testIndex = 0;
let companyIds: string[];
let userIds: string[];

function headersFor(userId: string): Record<string, string> {
  return { "x-test-user-id": userId };
}

async function makeUser(suffix: string) {
  const user = await prisma.user.create({
    data: {
      name: "Test User",
      email: `${suffix}-${RUN_ID}@example.test`,
      clerkUserId: `clerk-${suffix}-${RUN_ID}`,
      emailVerified: true,
    },
  });
  userIds.push(user.id);
  return user;
}

async function subscribe(userId: string, companyId: string) {
  return prisma.userCompanySubscription.create({ data: { userId, companyId } });
}

async function setPreferences(userId: string, data: Record<string, unknown>) {
  return prisma.userPreferences.create({ data: { userId, ...data } });
}

// roleFamily is validated live against a real ACTIVE job (same rule
// preferences enforces, see testCompanies/schemas.ts), so these two seed
// companies exist purely so "Software Engineer" and "Product Manager" are
// real, currently-available role families for the whole suite to use.
async function seedRealActiveJob(roleFamily: string, index: number): Promise<string> {
  const slug = `role-seed-${index}-${RUN_ID}`;
  const company = await prisma.company.create({ data: { name: `Role Seed ${index}`, slug, accessBasis: "OFFICIAL_API" } });
  const source = await prisma.jobSource.create({ data: { companyId: company.id, platform: "GREENHOUSE", config: { boardToken: "x" } } });
  await prisma.job.create({
    data: {
      companyId: company.id,
      sourceId: source.id,
      externalJobId: `${slug}-job`,
      identityHash: `${slug}-job`,
      contentHash: `${slug}-job`,
      title: roleFamily,
      roleFamily,
      sourceUrl: `https://example.test/${slug}`,
      opportunityType: "FULL_TIME",
      status: "ACTIVE",
    },
  });
  return company.id;
}

async function createTestCompany(): Promise<{ id: string; slug: string }> {
  const name = `Test Corp ${testIndex++} ${RUN_ID}`;
  const res = await app.inject({ method: "POST", url: "/test-companies", headers: adminHeaders, payload: { name } });
  assert.equal(res.statusCode, 201, res.body);
  const company = res.json().company as { id: string; slug: string };
  companyIds.push(company.id);
  return company;
}

async function createTestJob(slug: string, overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: `/test-companies/${slug}/jobs`,
    headers: adminHeaders,
    payload: {
      title: "Software Engineer",
      roleFamily: "Software Engineer",
      applicationUrl: "https://example.test/apply",
      locations: [],
      ...overrides,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().job as { id: string };
}

async function publish(jobId: string) {
  const res = await app.inject({ method: "POST", url: `/test-jobs/${jobId}/publish`, headers: adminHeaders });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as { result: { created: number; updated: number; queued: number }; job: { id: string } | null };
}

const BANGALORE: Record<string, unknown> = { countryCode: "IN", stateCode: "KA", cityName: "Bangalore" };

describe("admin/test-companies end-to-end (custom_company.txt Section 20)", () => {
  before(async () => {
    setUserResolverForTesting((request) => (request.headers["x-test-user-id"] as string) ?? null);
    setAdminEmailsForTesting([ADMIN_EMAIL]);

    app = Fastify();
    await app.register(testCompanyRoutes);
    await app.ready();

    const admin = await prisma.user.create({
      data: { name: "Admin", email: ADMIN_EMAIL, clerkUserId: `clerk-admin-${RUN_ID}` },
    });
    adminId = admin.id;
    adminHeaders = headersFor(adminId);

    seedRoleFamilyCompanyId = await seedRealActiveJob("Software Engineer", 1);
    await seedRealActiveJob("Product Manager", 2);
  });

  after(async () => {
    setUserResolverForTesting(undefined);
    setAdminEmailsForTesting(undefined);
    await prisma.company.delete({ where: { id: seedRoleFamilyCompanyId } }).catch(() => {});
    await prisma.company.deleteMany({ where: { slug: { startsWith: `role-seed-` }, name: { endsWith: RUN_ID } } });
    await prisma.user.delete({ where: { id: adminId } });
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    companyIds = [];
    userIds = [];
  });

  afterEach(async () => {
    // Cascades JobSource -> CustomTestJob/Job -> Notification for every
    // company this test created.
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("Test 1: matching subscriber gets a queued notification", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t1-match");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const job = await createTestJob(company.slug);
    const { result } = await publish(job.id);
    assert.equal(result.queued, 1);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notificationType, "NEW_JOB");
    assert.equal(notifications[0].status, "QUEUED", "must be queued, never sent directly by the publish request itself");
  });

  it("Test 2: wrong role does not notify", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t2-wrongrole");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const job = await createTestJob(company.slug, { title: "Product Manager", roleFamily: "Product Manager" });
    await publish(job.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);
  });

  it("Test 3: wrong location does not notify", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t3-wrongloc");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, {
      roleFamily: "Software Engineer",
      locations: { create: [{ countryCode: "IN", countryName: "India", stateCode: "MH", stateName: "Maharashtra", cityName: "Pune" }] },
    });

    const job = await createTestJob(company.slug, { locations: [BANGALORE] });
    await publish(job.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);
  });

  it("Test 4: a matching non-subscriber does not notify", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t4-nonsub");
    await setPreferences(user.id, { roleFamily: "Software Engineer" }); // matches, but never subscribes

    const job = await createTestJob(company.slug);
    await publish(job.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);
  });

  it("Test 5: a job published before the subscription does not notify (Scenario A)", async () => {
    const company = await createTestCompany();
    const job = await createTestJob(company.slug);
    await publish(job.id); // published first, no subscriber exists yet

    const user = await makeUser("t5-late");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0, "subscribing after the fact must not retroactively notify for pre-existing jobs");
  });

  it("Test 6: a job published after the subscription notifies exactly once (Scenario B)", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t6-new");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const job = await createTestJob(company.slug);
    const { result } = await publish(job.id);

    assert.equal(result.queued, 1);
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1);
  });

  it("Test 7: publishing (syncing) the same job twice does not duplicate the notification", async () => {
    const company = await createTestCompany();
    const user = await makeUser("t7-dup");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    const job = await createTestJob(company.slug);
    const first = await publish(job.id);
    assert.equal(first.result.created, 1);
    assert.equal(first.result.queued, 1);

    const second = await publish(job.id); // same content -> "unchanged", never re-enters matching
    assert.equal(second.result.created, 0);
    assert.equal(second.result.updated, 0);
    assert.equal(second.result.queued, 0);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 1, "still exactly one notification after re-publishing the unchanged job");
  });

  it("Test 8: multiple matching users all notify, a non-matching one does not", async () => {
    const company = await createTestCompany();
    const userA = await makeUser("t8-a");
    const userB = await makeUser("t8-b");
    const userC = await makeUser("t8-c");
    await Promise.all([subscribe(userA.id, company.id), subscribe(userB.id, company.id), subscribe(userC.id, company.id)]);
    await setPreferences(userA.id, { roleFamily: "Software Engineer" });
    await setPreferences(userB.id, { roleFamily: "Software Engineer" });
    await setPreferences(userC.id, { roleFamily: "Product Manager" });

    const job = await createTestJob(company.slug);
    const { result } = await publish(job.id);
    assert.equal(result.queued, 2);

    const [notifsA, notifsB, notifsC] = await Promise.all([
      prisma.notification.findMany({ where: { userId: userA.id } }),
      prisma.notification.findMany({ where: { userId: userB.id } }),
      prisma.notification.findMany({ where: { userId: userC.id } }),
    ]);
    assert.equal(notifsA.length, 1);
    assert.equal(notifsB.length, 1);
    assert.equal(notifsC.length, 0);
  });

  it("a non-admin (signed in, but not on ADMIN_EMAILS) is refused with 403, not silently allowed", async () => {
    const nonAdmin = await makeUser("not-admin");
    const res = await app.inject({
      method: "POST",
      url: "/test-companies",
      headers: headersFor(nonAdmin.id),
      payload: { name: "Should Not Be Created" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("creating a draft job never queues a notification: only publish touches the pipeline", async () => {
    const company = await createTestCompany();
    const user = await makeUser("draft-no-notify");
    await subscribe(user.id, company.id);
    await setPreferences(user.id, { roleFamily: "Software Engineer" });

    await createTestJob(company.slug); // created, never published

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    assert.equal(notifications.length, 0);
  });

  it("disabling a company deactivates its subscribers: it must stop counting as watched", async () => {
    const company = await createTestCompany();
    const userA = await makeUser("disable-a");
    const userB = await makeUser("disable-b");
    await subscribe(userA.id, company.id);
    await subscribe(userB.id, company.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/test-companies/${company.slug}`,
      headers: adminHeaders,
      payload: { status: "INACTIVE" },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().subscriptionsDeactivated, 2);

    const subs = await prisma.userCompanySubscription.findMany({ where: { companyId: company.id } });
    assert.equal(subs.length, 2);
    for (const sub of subs) {
      assert.equal(sub.active, false, "a disabled company's subscriptions must not still read as active");
      assert.ok(sub.deactivatedAt, "deactivatedAt must be set the same way an explicit unsubscribe sets it");
    }

    // Re-enabling must not retroactively resume anyone: same "must
    // explicitly re-subscribe" rule a reactivated real company already has.
    const reenable = await app.inject({
      method: "PATCH",
      url: `/test-companies/${company.slug}`,
      headers: adminHeaders,
      payload: { status: "ACTIVE" },
    });
    assert.equal(reenable.json().subscriptionsDeactivated, 0);
    const subsAfter = await prisma.userCompanySubscription.findMany({ where: { companyId: company.id, active: true } });
    assert.equal(subsAfter.length, 0);
  });
});
