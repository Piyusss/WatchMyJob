// Same rationale as greenhouse.test.ts, lever.test.ts and workday.test.ts:
// the real parsing path gets exercised against a recorded response with
// global fetch mocked, never a live request.
//
// Field mapping runs against __fixtures__/smartrecruiters-sodexo.json,
// eight real Sodexo postings chosen to cover the range actually observed
// live: permanent/casual/part-time employment, associate/entry_level/
// mid_senior_level/executive/not_applicable seniority, and both remote and
// on-site locations. Pagination uses synthetic pages, since what it asserts
// is about page walking and de-duplication rather than posting content.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SmartRecruitersAdapter } from "./smartrecruiters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "__fixtures__", "smartrecruiters-sodexo.json"), "utf8"),
);

const originalFetch = globalThis.fetch;

function mockFetchSequence(bodies: unknown[]) {
  let call = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const body = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
  return urls;
}

const SOURCE = { id: "s1", companyId: "c1", config: { company: "sodexo" } };

function page(ids: string[], totalFound: number, offset = 0) {
  return {
    offset,
    limit: 100,
    totalFound,
    content: ids.map((id) => ({
      id,
      name: `Job ${id}`,
      company: { identifier: "Sodexo" },
      location: { city: "Sydney", country: "au", remote: false, hybrid: false },
    })),
  };
}

describe("SmartRecruitersAdapter", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a real recorded response into the expected NormalizedJob shape", async () => {
    mockFetchSequence([fixture]);
    const result = await new SmartRecruitersAdapter().discoverJobs(SOURCE);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 8);

    const first = result.jobs[0];
    assert.equal(first.externalJobId, "744000147457590");
    assert.equal(first.location, "Queensland, REF, Australia");
    assert.equal(first.sourceUrl, "https://jobs.smartrecruiters.com/Sodexo/744000147457590");
    assert.ok(first.postedAt instanceof Date);
    // The list endpoint carries no description, and the adapter deliberately
    // does not make a per-posting request to fetch one.
    assert.equal(first.description, null);
  });

  it("maps employment type on id, not label: SmartRecruiters labels `permanent` as 'Full-time'", async () => {
    mockFetchSequence([fixture]);
    const jobs = (await new SmartRecruitersAdapter().discoverJobs(SOURCE)).jobs;

    const byId = new Map(jobs.map((j) => [j.externalJobId, j]));
    assert.equal(byId.get("744000147457590")?.opportunityTypeHint, "FULL_TIME"); // permanent
    assert.equal(byId.get("744000146656529")?.opportunityTypeHint, "OTHER"); // casual
    assert.equal(byId.get("744000146388489")?.opportunityTypeHint, "PART_TIME"); // part-time
  });

  it("only maps seniority values that line up with LEVEL_OPTIONS, leaving ambiguous ones null", async () => {
    mockFetchSequence([fixture]);
    const jobs = (await new SmartRecruitersAdapter().discoverJobs(SOURCE)).jobs;
    const byId = new Map(jobs.map((j) => [j.externalJobId, j]));

    assert.equal(byId.get("744000147457590")?.levelHint, "Associate");
    // mid_senior_level spans mid AND senior; calling it "Senior" would
    // over-promote every mid-level posting through a hard matching gate.
    assert.equal(byId.get("744000147404280")?.levelHint, null);
    assert.equal(byId.get("744000147415869")?.levelHint, null); // entry_level
    assert.equal(byId.get("744000146683339")?.levelHint, null); // executive
    assert.equal(byId.get("744000147143789")?.levelHint, null); // not_applicable
  });

  it("reads work mode from the structured booleans rather than the location string", async () => {
    mockFetchSequence([fixture]);
    const jobs = (await new SmartRecruitersAdapter().discoverJobs(SOURCE)).jobs;
    const byId = new Map(jobs.map((j) => [j.externalJobId, j]));

    assert.equal(byId.get("744000147370029")?.workMode, "REMOTE");
    // Both flags explicitly false is a statement of on-site, not an absence
    // of information, so it is not left null the way a location-string
    // guess would have to be.
    assert.equal(byId.get("744000147457590")?.workMode, "ON_SITE");
  });

  it("walks every page and reports COMPLETE", async () => {
    // totalFound has to exceed one page of 100 for a second request to be
    // warranted at all: with a smaller total the walk correctly stops after
    // page one, since offset 100 is already past the end.
    const urls = mockFetchSequence([
      page(["a", "b"], 150, 0),
      page(["c", "d"], 150, 100),
    ]);
    const result = await new SmartRecruitersAdapter().discoverJobs(SOURCE);

    assert.equal(result.jobs.length, 4);
    assert.equal(result.status, "COMPLETE");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("offset=0"));
    assert.ok(urls[1].includes("offset=100"));
  });

  it("de-duplicates a posting repeated across pages when the list shifts mid-walk", async () => {
    mockFetchSequence([page(["a", "b"], 150, 0), page(["b", "c"], 150, 100)]);
    const result = await new SmartRecruitersAdapter().discoverJobs(SOURCE);

    assert.deepEqual(
      result.jobs.map((j) => j.externalJobId),
      ["a", "b", "c"],
    );
  });

  it("stops on an empty page even when totalFound claims there is more", async () => {
    mockFetchSequence([page(["a"], 9999, 0), page([], 9999, 100)]);
    const result = await new SmartRecruitersAdapter().discoverJobs(SOURCE);

    assert.equal(result.jobs.length, 1);
    // Ended by running out of content rather than by hitting the page cap,
    // so absence still means something to closure.ts.
    assert.equal(result.status, "COMPLETE");
  });

  it("reports PARTIAL rather than COMPLETE when the page cap is hit", async () => {
    // Every page is full and totalFound never lets the walk finish, so the
    // MAX_PAGES guard is what ends it. PARTIAL matters: it stops closure.ts
    // treating the jobs never fetched as having disappeared.
    mockFetchSequence([page(Array.from({ length: 100 }, (_, i) => `j${i}`), 1_000_000, 0)]);
    const result = await new SmartRecruitersAdapter().discoverJobs(SOURCE);

    assert.equal(result.status, "PARTIAL");
  });
});
