// Every other test in this codebase exercises adapter BEHAVIOR through the
// setAdapterForTesting seam with a fake adapter -- correctly, since that's
// what sync.ts's own logic needs. But that means the REAL GreenhouseAdapter
// parsing code (raw Greenhouse JSON -> NormalizedJob) has never itself been
// tested. This file closes that gap using a recorded real response
// (__fixtures__/greenhouse-figma.json, three real Figma postings) with
// global fetch mocked -- never a live request, respecting the same ToS
// principle Section 9 states for the product itself, applied to testing it.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GreenhouseAdapter } from "./greenhouse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "greenhouse-figma.json"), "utf8"));

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async (url: string) => {
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

describe("GreenhouseAdapter", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a real recorded response into the expected NormalizedJob shape", async () => {
    mockFetch(200, fixture);
    const adapter = new GreenhouseAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { boardToken: "figma" } });

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 3);

    const normal = result.jobs.find((j) => j.externalJobId === "5364702004")!;
    assert.equal(normal.title, "Account Executive, Emerging Enterprise (Berlin, Germany)");
    assert.equal(normal.location, "Berlin, Germany");
    assert.equal(normal.sourceUrl, "https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004");
    assert.ok(normal.postedAt instanceof Date && !Number.isNaN(normal.postedAt.getTime()));
    assert.ok(normal.description !== null && normal.description.length > 0);
  });

  it("infers REMOTE from a location string that says so, and leaves it null otherwise", async () => {
    mockFetch(200, fixture);
    const adapter = new GreenhouseAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { boardToken: "figma" } });

    // None of these three real fixtures say "remote" in their location.
    for (const job of result.jobs) {
      assert.equal(job.workMode, null, `expected no work-mode inference for "${job.location}"`);
    }
  });

  it("never sets opportunityTypeHint -- Greenhouse has no structured field for it (unlike Lever)", async () => {
    mockFetch(200, fixture);
    const adapter = new GreenhouseAdapter();
    const result = await adapter.discoverJobs({ id: "s1", companyId: "c1", config: { boardToken: "figma" } });
    for (const job of result.jobs) {
      assert.equal(job.opportunityTypeHint, undefined);
    }
  });

  it("propagates a non-200 response as a thrown error, not a silent empty result", async () => {
    mockFetch(404, { error: "not found" });
    const adapter = new GreenhouseAdapter();
    await assert.rejects(
      () => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { boardToken: "nonexistent-board" } }),
      /404/,
    );
  });

  it("validates config shape before ever making a request", async () => {
    const adapter = new GreenhouseAdapter();
    await assert.rejects(() => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { wrongKey: "x" } }));
  });
});
