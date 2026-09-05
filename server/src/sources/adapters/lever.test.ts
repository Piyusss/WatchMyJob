// Same rationale as greenhouse.test.ts: the real LeverAdapter parsing code
// has never been directly tested, only exercised live during manual Phase
// 11 verification. Uses a recorded real response
// (__fixtures__/lever-palantir.json, three real Palantir postings covering
// full-time/hybrid, internship/onsite, and contractor/hybrid) with global
// fetch mocked: never a live request.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LeverAdapter } from "./lever.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "lever-palantir.json"), "utf8"));

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
}

describe("LeverAdapter", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a real recorded response into the expected NormalizedJob shape", async () => {
    mockFetch(200, fixture);
    const adapter = new LeverAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { site: "palantir" } });

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 3);

    const normal = result.jobs.find((j) => j.title === "Administrative Business Partner")!;
    assert.equal(normal.location, "London, United Kingdom");
    assert.equal(normal.sourceUrl, "https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c");
    assert.ok(normal.postedAt instanceof Date && !Number.isNaN(normal.postedAt.getTime()));
  });

  it("maps the structured workplaceType field directly, not by guessing from the location string", async () => {
    mockFetch(200, fixture);
    const adapter = new LeverAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { site: "palantir" } });

    const hybrid = result.jobs.find((j) => j.title === "Administrative Business Partner")!;
    const onsite = result.jobs.find((j) => j.title === "Deployment Strategist, Internship")!;
    assert.equal(hybrid.workMode, "HYBRID");
    assert.equal(onsite.workMode, "ON_SITE");
    // Neither location string contains the word "remote": confirms this
    // came from workplaceType, not a location-text guess like Greenhouse's.
    assert.doesNotMatch(hybrid.location ?? "", /remote/i);
    assert.doesNotMatch(onsite.location ?? "", /remote/i);
  });

  it("maps the structured commitment field to opportunityTypeHint, which classify.ts (Phase 8) prefers over title parsing", async () => {
    mockFetch(200, fixture);
    const adapter = new LeverAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { site: "palantir" } });

    const fullTime = result.jobs.find((j) => j.title === "Administrative Business Partner")!;
    const internship = result.jobs.find((j) => j.title === "Deployment Strategist, Internship")!;
    const contractor = result.jobs.find((j) => j.title === "Talent Sourcer (Contractor)")!;
    assert.equal(fullTime.opportunityTypeHint, "FULL_TIME");
    assert.equal(internship.opportunityTypeHint, "INTERNSHIP");
    assert.equal(contractor.opportunityTypeHint, "CONTRACT");
  });

  it("propagates a non-200 response as a thrown error", async () => {
    mockFetch(404, { error: "not found" });
    const adapter = new LeverAdapter();
    await assert.rejects(() => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { site: "nonexistent" } }), /404/);
  });

  it("validates config shape before ever making a request", async () => {
    const adapter = new LeverAdapter();
    await assert.rejects(() => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { wrongKey: "x" } }));
  });
});
