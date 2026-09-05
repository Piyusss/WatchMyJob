// Same rationale as greenhouse.test.ts, lever.test.ts, workday.test.ts and
// smartrecruiters.test.ts: the real parsing path runs against a recorded
// response with global fetch mocked, never a live request.
//
// __fixtures__/ashby-mixed.json is eight real postings pulled off the
// OpenAI, Cohere and Ramp boards, chosen so that between them they hit
// every branch this adapter has: all three workplaceType values plus null,
// all four employmentType values observed live, postings with and without
// secondary locations, and (the important one) a Hybrid posting whose
// isRemote flag reads true.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AshbyAdapter } from "./ashby.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "ashby-mixed.json"), "utf8"));

const originalFetch = globalThis.fetch;

function mockFetch(body: unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
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

const SOURCE = { id: "s1", companyId: "c1", config: { jobBoardName: "openai" } };

async function discover(body: unknown = fixture) {
  mockFetch(body);
  return new AshbyAdapter().discoverJobs(SOURCE);
}

async function byId(body: unknown = fixture) {
  const result = await discover(body);
  return new Map(result.jobs.map((j) => [j.externalJobId, j]));
}

describe("AshbyAdapter", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a real recorded response into the expected NormalizedJob shape", async () => {
    const result = await discover();

    assert.equal(result.jobs.length, 8);
    // One request returns the whole board, so this adapter has no way to
    // produce a partial list.
    assert.equal(result.status, "COMPLETE");

    const first = result.jobs[0];
    assert.equal(first.externalJobId, "13995549-e8cc-498f-9eaa-1869067ac35b");
    assert.equal(first.title, "Software Engineer, RL Training Infra");
    assert.equal(first.location, "San Francisco");
    assert.equal(first.sourceUrl, "https://jobs.ashbyhq.com/openai/13995549-e8cc-498f-9eaa-1869067ac35b");
    assert.equal(first.postedAt?.toISOString(), "2026-05-23T02:00:50.464Z");
  });

  it("fetches the whole board in a single request", async () => {
    const urls = mockFetch(fixture);
    await new AshbyAdapter().discoverJobs(SOURCE);

    assert.equal(urls.length, 1);
    assert.equal(urls[0], "https://api.ashbyhq.com/posting-api/job-board/openai");
  });

  // The reason this adapter reads workplaceType and ignores isRemote. Across
  // the 1,223 postings sampled while building it, isRemote was true for
  // exactly Hybrid + Remote, so it means "not strictly on-site". Reading it
  // would push hybrid roles through the REMOTE gate in matching/predicate.ts.
  it("does not call a Hybrid posting REMOTE just because isRemote is true", async () => {
    const jobs = await byId();

    const hybrid = jobs.get("13995549-e8cc-498f-9eaa-1869067ac35b");
    assert.equal(hybrid?.workMode, "HYBRID");
    // Guards the fixture itself: if this posting ever stopped carrying the
    // contradictory flag, the assertion above would pass for the wrong
    // reason and stop testing anything.
    assert.equal(fixture.jobs.find((j: { id: string }) => j.id === hybrid?.externalJobId).isRemote, true);
  });

  it("maps every workplaceType observed live, and leaves an absent one null", async () => {
    const jobs = await byId();

    assert.equal(jobs.get("676d359b-0ef6-40a5-81d5-d4f2eb198eab")?.workMode, "REMOTE");
    assert.equal(jobs.get("49ae54dc-3d33-4107-8112-63fac1ee86ca")?.workMode, "ON_SITE");
    // Null rather than a guess from the location string: matchWorkMode
    // treats null as "don't block", which is the honest reading of a field
    // the company never filled in.
    assert.equal(jobs.get("8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3")?.workMode, null);
  });

  it("maps employment type, sending Temporary to OTHER rather than guessing CONTRACT", async () => {
    const jobs = await byId();

    assert.equal(jobs.get("13995549-e8cc-498f-9eaa-1869067ac35b")?.opportunityTypeHint, "FULL_TIME");
    assert.equal(jobs.get("8c035d3d-081d-4c8a-914a-72f4efaad254")?.opportunityTypeHint, "INTERNSHIP");
    assert.equal(jobs.get("dbd5ae8a-7c01-4f17-be39-b8caa8fd95d5")?.opportunityTypeHint, "CONTRACT");
    assert.equal(jobs.get("4bc09b14-0389-40cd-9d5b-f5557f451d50")?.opportunityTypeHint, "OTHER");
  });

  // matchLocation is a substring test over one string, so a posting open in
  // four places has to name all four or it silently fails to match three
  // quarters of the users it should reach.
  it("folds secondary locations into the location string", async () => {
    const jobs = await byId();

    assert.equal(
      jobs.get("8c035d3d-081d-4c8a-914a-72f4efaad254")?.location,
      "Canada, Dubai, London, United States, United Kingdom",
    );
    assert.equal(
      jobs.get("f763c6b3-5167-4a67-b691-4c3fa2c44156")?.location,
      "San Francisco, New York City, Seattle, Mountain View",
    );
  });

  it("does not repeat a location that appears as both primary and secondary", async () => {
    const jobs = await byId({
      jobs: [
        {
          id: "dup",
          title: "Engineer",
          location: "Bengaluru",
          secondaryLocations: [{ location: "bengaluru" }, { location: "Pune" }],
          jobUrl: "https://jobs.ashbyhq.com/x/dup",
        },
      ],
    });

    assert.equal(jobs.get("dup")?.location, "Bengaluru, Pune");
  });

  it("prefers descriptionPlain, which already carries the section breaks the classifier reads", async () => {
    const jobs = await byId({
      jobs: [
        {
          id: "d1",
          title: "Engineer",
          descriptionPlain: "REQUIREMENTS\n\n5+ years of experience",
          descriptionHtml: "<p>REQUIREMENTS</p><p>5+ years of experience</p>",
          jobUrl: "https://jobs.ashbyhq.com/x/d1",
        },
        // Falls back rather than dropping the description entirely: a board
        // that only fills the HTML field still feeds the classifier.
        {
          id: "d2",
          title: "Engineer",
          descriptionPlain: "",
          descriptionHtml: "<p>3+ years</p>",
          jobUrl: "https://jobs.ashbyhq.com/x/d2",
        },
      ],
    });

    assert.equal(jobs.get("d1")?.description, "REQUIREMENTS\n\n5+ years of experience");
    assert.equal(jobs.get("d2")?.description, "<p>3+ years</p>");
  });

  it("drops an explicitly unlisted posting, since it is not one anyone can apply to", async () => {
    const result = await discover({
      jobs: [
        { id: "shown", title: "A", isListed: true, jobUrl: "https://jobs.ashbyhq.com/x/shown" },
        { id: "hidden", title: "B", isListed: false, jobUrl: "https://jobs.ashbyhq.com/x/hidden" },
        // Absent isListed is not the same claim as false, so this one stays.
        { id: "unstated", title: "C", jobUrl: "https://jobs.ashbyhq.com/x/unstated" },
      ],
    });

    assert.deepEqual(
      result.jobs.map((j) => j.externalJobId),
      ["shown", "unstated"],
    );
  });

  it("rejects a response whose shape changed rather than emitting garbage jobs", async () => {
    mockFetch({ jobs: [{ id: 12345, title: "Engineer" }] });
    await assert.rejects(() => new AshbyAdapter().discoverJobs(SOURCE));
  });
});
