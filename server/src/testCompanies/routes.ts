// The admin/test tab's HTTP surface (see custom_company.txt): lets an
// authorized admin create a synthetic company and publish synthetic jobs
// through the SAME job pipeline real sources use (see sync.ts's syncSource
// and sources/adapters/customTest.ts), to exercise the real end-to-end
// notification system without depending on an external ATS actually having
// a matching opening right now. Registration of this whole plugin is gated
// on allowTestCompanies in index.ts: every handler here additionally
// requires requireAdmin, so reaching it at all needs both the environment
// gate AND an allowlisted Clerk account.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { requireAdmin } from "../auth/authenticate.js";
import { toLocationRow } from "../preferences/schemas.js";
import { SELECTABLE_COMPANY } from "../companies/selectable.js";
import { deactivateSubscriptionsForCompany } from "../subscriptions/deactivateForCompany.js";
import { runInitialSync, syncSource } from "../sources/sync.js";
import { summarizeSyncResult } from "../sources/format.js";
import { createTestCompanySchema, updateTestCompanyStatusSchema, createTestJobSchema, updateTestJobSchema, slugify } from "./schemas.js";

function serializeJob(job: {
  id: string;
  title: string;
  roleFamily: string;
  level: string | null;
  workMode: string | null;
  opportunityType: string;
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
  description: string | null;
  applicationUrl: string;
  publishedAt: Date | null;
  locations: { countryCode: string; countryName: string; stateCode: string | null; stateName: string | null; cityName: string | null }[];
}) {
  return {
    id: job.id,
    title: job.title,
    roleFamily: job.roleFamily,
    level: job.level,
    workMode: job.workMode,
    opportunityType: job.opportunityType,
    requiredExperienceMin: job.requiredExperienceMin,
    requiredExperienceMax: job.requiredExperienceMax,
    description: job.description,
    applicationUrl: job.applicationUrl,
    published: job.publishedAt !== null,
    publishedAt: job.publishedAt,
    locations: job.locations.map((l) => ({
      countryCode: l.countryCode,
      countryName: l.countryName,
      stateCode: l.stateCode,
      stateName: l.stateName,
      cityName: l.cityName,
    })),
  };
}

// roleFamily has no fixed taxonomy (see jobs/routes.ts's /role-families
// comment): "controlled selection, not free text" means it must be a
// value that's actually on a real active job right now, the exact same
// live check preferences/routes.ts runs for a user's own roleFamily
// preference. A test job is subject to the identical rule, not a looser one.
async function requireRealRoleFamily(roleFamily: string): Promise<boolean> {
  const exists = await prisma.job.findFirst({ where: { status: "ACTIVE", roleFamily }, select: { id: true } });
  return exists !== null;
}

async function requireTestCompany(slug: string) {
  return prisma.company.findFirst({ where: { slug, isTestCompany: true }, include: { sources: true } });
}

function customTestSourceOf(company: { sources: { id: string; platform: string }[] }) {
  return company.sources.find((s) => s.platform === "CUSTOM_TEST") ?? null;
}

export async function testCompanyRoutes(fastify: FastifyInstance) {
  fastify.get("/test-companies", { preHandler: requireAdmin }, async (_request, reply) => {
    const companies = await prisma.company.findMany({
      where: { isTestCompany: true },
      orderBy: { createdAt: "desc" },
      include: { sources: { select: { id: true } } },
    });

    const companyIds = companies.map((c) => c.id);
    const sourceIds = companies.flatMap((c) => c.sources.map((s) => s.id));

    const [openCounts, draftCounts] = await Promise.all([
      companyIds.length > 0
        ? prisma.job.groupBy({ by: ["companyId"], where: { status: "ACTIVE", companyId: { in: companyIds } }, _count: true })
        : Promise.resolve([]),
      sourceIds.length > 0
        ? prisma.customTestJob.groupBy({ by: ["sourceId"], where: { sourceId: { in: sourceIds } }, _count: true })
        : Promise.resolve([]),
    ]);

    const openByCompany = new Map(openCounts.map((c) => [c.companyId, c._count]));
    const draftsBySource = new Map(draftCounts.map((d) => [d.sourceId, d._count]));

    return reply.send({
      companies: companies.map((c) => {
        const sourceId = c.sources[0]?.id ?? null;
        return {
          id: c.id,
          name: c.name,
          slug: c.slug,
          status: c.status,
          domain: c.domain,
          createdAt: c.createdAt,
          openJobs: openByCompany.get(c.id) ?? 0,
          totalTestJobs: sourceId ? (draftsBySource.get(sourceId) ?? 0) : 0,
        };
      }),
    });
  });

  fastify.post("/test-companies", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createTestCompanySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }
    const input = parsed.data;
    const slug = slugify(input.slug || input.name);
    if (!slug) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: { name: ["Must contain at least one letter or number"] } });
    }

    const existing = await prisma.company.findUnique({ where: { slug } });
    if (existing) {
      return reply.code(409).send({ error: `A company with slug "${slug}" already exists` });
    }

    const company = await prisma.company.create({
      data: {
        name: input.name,
        slug,
        // No real ToS to comply with for synthetic data the admin authored
        // themselves: WRITTEN_PERMISSION is the closest real value (you
        // always have permission over your own fixture); a dedicated enum
        // value here would just duplicate what isTestCompany already says.
        accessBasis: "WRITTEN_PERMISSION",
        domain: input.domain,
        isTestCompany: true,
      },
    });

    // Every test company gets exactly one CUSTOM_TEST source: the
    // "Custom Test Job API" from custom_company.txt's own architecture
    // diagram, reusing JobSource rather than inventing a parallel concept.
    await prisma.jobSource.create({ data: { companyId: company.id, platform: "CUSTOM_TEST", config: {} } });

    // Baselined immediately at zero jobs (no CustomTestJob rows exist yet)
    // so the company is selectable/watchable from the moment it's created,
    // not deferred until the first job is published: Section 12's
    // Scenario B (subscribe BEFORE any job exists) needs that to work.
    await runInitialSync(slug, { allowEmpty: true });

    return reply.code(201).send({ company });
  });

  fastify.patch<{ Params: { slug: string } }>("/test-companies/:slug", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = updateTestCompanyStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }

    const company = await requireTestCompany(request.params.slug);
    if (!company) {
      return reply.code(404).send({ error: "No such test company" });
    }

    const updated = await prisma.company.update({ where: { id: company.id }, data: { status: parsed.data.status } });

    // A disabled company must stop counting as "watched": see
    // deactivateForCompany.ts for why this can't just be left to the
    // send-time recheck alone.
    const subscriptionsDeactivated =
      parsed.data.status === "INACTIVE" ? await deactivateSubscriptionsForCompany(company.id) : 0;

    return reply.send({ company: updated, subscriptionsDeactivated });
  });

  fastify.get<{ Params: { slug: string } }>("/test-companies/:slug", { preHandler: requireAdmin }, async (request, reply) => {
    const company = await requireTestCompany(request.params.slug);
    if (!company) {
      return reply.code(404).send({ error: "No such test company" });
    }
    const source = customTestSourceOf(company);
    if (!source) {
      return reply.code(500).send({ error: "Test company is missing its CUSTOM_TEST source" });
    }

    const [drafts, jobs, selectable] = await Promise.all([
      prisma.customTestJob.findMany({
        where: { sourceId: source.id },
        include: { locations: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.job.findMany({
        where: { sourceId: source.id },
        select: { id: true, externalJobId: true, status: true },
      }),
      prisma.company.findFirst({ where: { id: company.id, ...SELECTABLE_COMPANY }, select: { id: true } }),
    ]);

    const jobByDraftId = new Map(jobs.map((j) => [j.externalJobId, j]));

    return reply.send({
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        status: company.status,
        domain: company.domain,
        selectable: selectable !== null,
      },
      jobs: drafts.map((d) => ({ ...serializeJob(d), job: jobByDraftId.get(d.id) ?? null })),
    });
  });

  fastify.post<{ Params: { slug: string } }>("/test-companies/:slug/jobs", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createTestJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }
    const input = parsed.data;

    const company = await requireTestCompany(request.params.slug);
    if (!company) {
      return reply.code(404).send({ error: "No such test company" });
    }
    const source = customTestSourceOf(company);
    if (!source) {
      return reply.code(500).send({ error: "Test company is missing its CUSTOM_TEST source" });
    }

    if (!(await requireRealRoleFamily(input.roleFamily))) {
      return reply.code(400).send({ error: "Invalid input", details: { roleFamily: ["Not a currently available role"] } });
    }

    const job = await prisma.customTestJob.create({
      data: {
        sourceId: source.id,
        title: input.title,
        roleFamily: input.roleFamily,
        level: input.level,
        workMode: input.workMode,
        opportunityType: input.opportunityType,
        requiredExperienceMin: input.requiredExperienceMin,
        requiredExperienceMax: input.requiredExperienceMax,
        description: input.description,
        applicationUrl: input.applicationUrl,
        locations: { create: input.locations.map(toLocationRow) },
      },
      include: { locations: true },
    });

    return reply.code(201).send({ job: serializeJob(job) });
  });

  fastify.patch<{ Params: { jobId: string } }>("/test-jobs/:jobId", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = updateTestJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
    }
    const input = parsed.data;

    const existing = await prisma.customTestJob.findUnique({
      where: { id: request.params.jobId },
      include: { source: true },
    });
    if (!existing || existing.source.platform !== "CUSTOM_TEST") {
      return reply.code(404).send({ error: "No such test job" });
    }

    if (!(await requireRealRoleFamily(input.roleFamily))) {
      return reply.code(400).send({ error: "Invalid input", details: { roleFamily: ["Not a currently available role"] } });
    }

    const job = await prisma.customTestJob.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        roleFamily: input.roleFamily,
        level: input.level,
        workMode: input.workMode,
        opportunityType: input.opportunityType,
        requiredExperienceMin: input.requiredExperienceMin,
        requiredExperienceMax: input.requiredExperienceMax,
        description: input.description,
        applicationUrl: input.applicationUrl,
        // Full replace, same convention preferences/routes.ts uses for its
        // own one-to-many locations relation: the form always submits the
        // complete current list.
        locations: { deleteMany: {}, create: input.locations.map(toLocationRow) },
      },
      include: { locations: true },
    });

    return reply.send({ job: serializeJob(job) });
  });

  // The one action in this whole surface that touches the real pipeline.
  // Everything before this point (creating the company, creating a draft
  // job) only ever writes rows an adapter hasn't been asked to look at yet:
  // Section 8's "creating must not itself notify anyone".
  fastify.post<{ Params: { jobId: string } }>("/test-jobs/:jobId/publish", { preHandler: requireAdmin }, async (request, reply) => {
    const draft = await prisma.customTestJob.findUnique({
      where: { id: request.params.jobId },
      include: { source: { include: { company: true } } },
    });
    if (!draft || draft.source.platform !== "CUSTOM_TEST") {
      return reply.code(404).send({ error: "No such test job" });
    }
    if (draft.source.company.status !== "ACTIVE") {
      return reply.code(400).send({ error: `${draft.source.company.name} is disabled. Reactivate it first` });
    }

    // Set once, on the transition from draft to published: left alone on
    // every later publish (an edit-then-republish), so this always records
    // when the job FIRST went live, not when it was last touched.
    if (!draft.publishedAt) {
      await prisma.customTestJob.update({ where: { id: draft.id }, data: { publishedAt: new Date() } });
    }

    // The exact pipeline a real source's scheduled sync runs: discover
    // (adapters/customTest.ts reads every published row back), normalize,
    // dedupe against Postgres, persist, then match against every
    // subscriber (sync.ts -> matching/engine.ts). This just triggers it
    // immediately instead of waiting for the background poller's next tick
    // (worker.ts polls every baselined source regardless of platform):
    // the same relationship admin:sync already has to the scheduled path
    // for real companies, not a shortcut around it.
    const source = await prisma.jobSource.findUniqueOrThrow({ where: { id: draft.source.id } });
    const result = await syncSource(source);

    const job = await prisma.job.findFirst({
      where: { sourceId: draft.source.id, externalJobId: draft.id },
      select: { id: true, status: true, title: true },
    });

    const notificationCounts = job
      ? await prisma.notification.groupBy({ by: ["status"], where: { jobId: job.id }, _count: true })
      : [];

    return reply.send({
      result: { ...result, summary: summarizeSyncResult(result) },
      job,
      notificationsByStatus: Object.fromEntries(notificationCounts.map((n) => [n.status, n._count])),
    });
  });
}
