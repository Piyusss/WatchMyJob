// Same rationale as greenhouse.test.ts and lever.test.ts, with one addition:
// Workday is the first adapter that paginates and the first that makes a
// second request per job, so the mechanics of both are tested here rather
// than only the field mapping.
//
// Field-mapping tests run against __fixtures__/workday-citi.json: four real
// Citi postings recorded live from citi.wd5.myworkdayjobs.com together with
// their real detail records, covering Hybrid and On-Site remote types.
// Pagination tests use synthetic pages, because what they assert is about
// page counts and repeats rather than the content of any posting.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkdayAdapter, type KnownJobLoader, type KnownJobSnapshot } from "./workday.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__", "workday-citi.json"), "utf8")) as {
  list: { total: number; jobPostings: RawPosting[] };
  details: Record<string, unknown>;
};

interface RawPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

const CONFIG = { host: "citi.wd5.myworkdayjobs.com", tenant: "citi", site: "2" };
const SOURCE = { id: "s1", companyId: "c1", config: CONFIG };
const PAGE_SIZE = 20;

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface MockOptions {
  pages: RawPosting[][];
  details?: Record<string, unknown>;
}

// Serves the search endpoint from `pages` (indexed by offset/PAGE_SIZE) and
// the detail endpoint from `details`, and records what was requested so a
// test can assert how many detail calls actually happened.
function mockWorkday(options: MockOptions) {
  const detailPathsFetched: string[] = [];
  let listRequests = 0;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (init?.method === "POST") {
      listRequests++;
      const body = JSON.parse(String(init.body)) as { offset: number; limit: number };
      assert.equal(body.limit, PAGE_SIZE, "the search endpoint rejects any limit above 20");
      const jobPostings = options.pages[body.offset / PAGE_SIZE] ?? [];
      return jsonResponse({ total: 9999, jobPostings });
    }
    const externalPath = target.slice(target.indexOf("/job/"));
    detailPathsFetched.push(externalPath);
    return jsonResponse(options.details?.[externalPath] ?? { jobPostingInfo: {} });
  }) as unknown as typeof fetch;

  return {
    detailPathsFetched,
    get listRequests() {
      return listRequests;
    },
  };
}

const noKnownJobs: KnownJobLoader = async () => new Map();

// A full page of distinct synthetic postings starting at `start`.
function syntheticPage(start: number): RawPosting[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => ({
    title: `Engineer ${start + i}`,
    externalPath: `/job/Somewhere/Engineer-${start + i}_${start + i}`,
    locationsText: "Somewhere",
    bulletFields: [String(start + i)],
  }));
}

describe("WorkdayAdapter", () => {
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses recorded real postings into the expected NormalizedJob shape", async () => {
    mockWorkday({ pages: [fixture.list.jobPostings], details: fixture.details });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 4);

    const job = result.jobs.find((j) => j.externalJobId === "26992731")!;
    assert.ok(job, "requisition id from bulletFields is the external identity");
    assert.equal(job.title, "CCB Brazil Trade Sales Head - SVP");
    assert.equal(job.location, "Sao Paulo Sao Paulo Brazil");
    assert.equal(job.sourceUrl, "https://citi.wd5.myworkdayjobs.com/2/job/Sao-Paulo-Sao-Paulo-Brazil/CCB-Trade-Sales-Head---SVP_26992731-1");
    assert.ok(job.description && job.description.length > 0, "description comes from the detail record");
  });

  it("takes the posting date from startDate and never from the relative postedOn prose", async () => {
    mockWorkday({ pages: [fixture.list.jobPostings], details: fixture.details });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    const job = result.jobs.find((j) => j.externalJobId === "26992731")!;
    // Every recorded posting says "Posted Today": unparseable into an
    // instant. The real date only exists on the detail record.
    assert.equal(fixture.list.jobPostings.find((p) => p.bulletFields?.[0] === "26992731")?.postedOn, "Posted Today");
    assert.ok(job.postedAt instanceof Date && !Number.isNaN(job.postedAt.getTime()));
    assert.equal(job.postedAt.toISOString().slice(0, 10), "2026-09-04");
  });

  it("maps the structured remoteType field rather than guessing from the location string", async () => {
    mockWorkday({ pages: [fixture.list.jobPostings], details: fixture.details });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    const hybrid = result.jobs.find((j) => j.externalJobId === "26992731")!;
    assert.equal(hybrid.workMode, "HYBRID");
    // No location string here contains "remote", so HYBRID/ON_SITE could
    // only have come from remoteType: inferWorkMode can never return them.
    assert.ok(result.jobs.some((j) => j.workMode === "ON_SITE"), "On-Site maps to ON_SITE");
    for (const job of result.jobs) assert.doesNotMatch(job.location ?? "", /remote/i);
  });

  it("maps timeType to opportunityTypeHint, which classify.ts prefers over title parsing", async () => {
    mockWorkday({ pages: [fixture.list.jobPostings], details: fixture.details });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.jobs.find((j) => j.externalJobId === "26992731")!.opportunityTypeHint, "FULL_TIME");
  });

  it("walks every page and stops on the empty page that ends the list", async () => {
    const mock = mockWorkday({ pages: [syntheticPage(0), syntheticPage(20), []] });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 40);
    assert.equal(mock.listRequests, 3);
  });

  it("stops on a short page without spending a request to confirm the end", async () => {
    const mock = mockWorkday({ pages: [syntheticPage(0), syntheticPage(20).slice(0, 7)] });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 27);
    assert.equal(mock.listRequests, 2, "a short page is already the last one");
  });

  // The behavior this adapter exists to survive. Citi's tenant stops
  // advancing at offset 2000 and returns the same twenty postings forever:
  // full pages, HTTP 200, no error anywhere. Reporting COMPLETE here would
  // tell sync.ts that every posting past the clamp had disappeared, and the
  // closure logic would work through thousands of live jobs and close them.
  it("reports PARTIAL when the source stops advancing and repeats a page", async () => {
    const frozen = syntheticPage(40);
    const mock = mockWorkday({ pages: [syntheticPage(0), syntheticPage(20), frozen, frozen, frozen] });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.status, "PARTIAL", "a repeating page means the walk never reached the end");
    // The frozen page's own postings were collected the first time it was
    // served; what makes this PARTIAL is that pagination could go no further.
    assert.equal(result.jobs.length, 60);
    assert.equal(mock.listRequests, 4, "stops on the first fully-repeated page rather than looping");
  });

  it("treats a partially-overlapping page as ordinary churn, not as the clamp", async () => {
    // A board reshuffling between two requests can repeat some postings; that
    // is not the clamp, which repeats every single one.
    const overlapping = [...syntheticPage(20).slice(0, 15), ...syntheticPage(40).slice(0, 5)];
    mockWorkday({ pages: [syntheticPage(0), overlapping, []] });
    const result = await new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE);

    assert.equal(result.status, "COMPLETE");
    assert.equal(result.jobs.length, 40, "the 15 already-seen postings are not collected twice");
  });

  it("fetches a detail record only for postings it has never seen before", async () => {
    const stored: KnownJobSnapshot = {
      description: "<p>stored description</p>",
      postedAt: new Date("2026-08-01T00:00:00.000Z"),
      workMode: "REMOTE",
      opportunityType: "FULL_TIME",
    };
    // Three of the four recorded postings are already persisted.
    const knownIds = fixture.list.jobPostings.slice(0, 3).map((p) => p.bulletFields![0]!);
    const loader: KnownJobLoader = async () => new Map(knownIds.map((id) => [id, stored]));

    const mock = mockWorkday({ pages: [fixture.list.jobPostings], details: fixture.details });
    const result = await new WorkdayAdapter(loader).discoverJobs(SOURCE);

    assert.equal(result.jobs.length, 4, "every posting is still reported, seen before or not");
    assert.equal(mock.detailPathsFetched.length, 1, "only the one unknown posting costs a second request");

    // A known posting reuses what was stored, so its contentHash inputs stay
    // identical and sync.ts sees it as unchanged instead of churning it.
    const reused = result.jobs.find((j) => j.externalJobId === knownIds[0])!;
    assert.equal(reused.description, stored.description);
    assert.equal(reused.workMode, "REMOTE");
    assert.deepEqual(reused.postedAt, stored.postedAt);
  });

  it("propagates a non-200 response as a thrown error", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers(),
        json: async () => ({}),
        text: async () => "{}",
      }) as Response) as unknown as typeof fetch;

    await assert.rejects(() => new WorkdayAdapter(noKnownJobs).discoverJobs(SOURCE), /404/);
  });

  it("validates config shape before ever making a request", async () => {
    const adapter = new WorkdayAdapter(noKnownJobs);
    // A bare tenant name is not a usable host: the datacenter number cannot
    // be guessed, so it has to be stored explicitly.
    await assert.rejects(() => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { host: "citi", tenant: "citi", site: "2" } }));
    await assert.rejects(() => adapter.discoverJobs({ id: "s1", companyId: "c1", config: { tenant: "citi", site: "2" } }));
  });
});
