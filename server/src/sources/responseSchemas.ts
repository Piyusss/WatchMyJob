import { z } from "zod";

// Runtime shape validation for each platform's raw API response, applied
// right after fetchJson parses the body and before any adapter maps it to
// NormalizedJob. Catches a malformed or unexpectedly-shaped response with a
// clear validation error instead of a confusing crash deep in a .map() call
// (or worse, silently producing garbage jobs from a field that quietly
// changed type upstream).

export const greenhouseBoardResponseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string() }).nullable(),
      content: z.string().nullable(),
      first_published: z.string().nullable(),
      updated_at: z.string().nullable(),
    }),
  ),
});

// Workday's CXS search endpoint. `total` is deliberately optional and
// deliberately NOT used to drive pagination: observed live on Citi's tenant
// returning 0 at offset 1980 and 2000 at offset 2000 for the same board, so
// it is a display hint, not a count to trust. See adapters/workday.ts for
// how the end of the list is actually detected.
export const workdayListResponseSchema = z.object({
  total: z.number().optional(),
  jobPostings: z.array(
    z.object({
      // Optional only because some tenants list a posting as a bare
      // `{ bulletFields: ["R169772"] }` stub with no title or path (Adobe,
      // Nasdaq and Elsevier each had one or two, the same requisitions on
      // every walk). The adapter skips those rather than failing the page.
      title: z.string().optional(),
      externalPath: z.string().optional(),
      locationsText: z.string().nullable().optional(),
      postedOn: z.string().nullable().optional(),
      // The company's own requisition id: the stable external identity.
      // Observed as a single-element array on every tenant probed, but the
      // field is a list, so an empty one has to be tolerated rather than
      // indexed blindly.
      bulletFields: z.array(z.string()).optional(),
    }),
  ),
});

// The per-job detail record. Everything the list endpoint omits and the
// pipeline needs: a real posting date, the description that experience
// classification reads, and structured work-mode/commitment values: lives
// here and nowhere else.
export const workdayDetailResponseSchema = z.object({
  jobPostingInfo: z.object({
    title: z.string().optional(),
    jobDescription: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    // ISO date ("2026-09-04"). The sibling `postedOn` is relative prose
    // ("Posted Today") and is ignored: see adapters/workday.ts.
    startDate: z.string().nullable().optional(),
    timeType: z.string().nullable().optional(),
    remoteType: z.string().nullable().optional(),
    jobReqId: z.string().nullable().optional(),
    externalUrl: z.string().nullable().optional(),
  }),
});

export const leverResponseSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    categories: z
      .object({
        location: z.string().optional(),
        commitment: z.string().optional(),
      })
      .nullable(),
    hostedUrl: z.string(),
    createdAt: z.number(),
    workplaceType: z.string().nullable(),
    description: z.string().nullable(),
  }),
);

// SmartRecruiters' public postings API. Keyless and designed for embedding
// on a company's own careers page, same basis as Greenhouse's and Lever's.
//
// Everything except id/name is optional because the API omits rather than
// nulls: `department` comes back as a bare {} on plenty of real postings,
// and experienceLevel/typeOfEmployment are absent entirely on some.
export const smartRecruitersResponseSchema = z.object({
  offset: z.number(),
  limit: z.number(),
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      company: z.object({ identifier: z.string() }),
      releasedDate: z.string().nullable().optional(),
      location: z
        .object({
          city: z.string().nullable().optional(),
          region: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          remote: z.boolean().optional(),
          hybrid: z.boolean().optional(),
          fullLocation: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      typeOfEmployment: z.object({ id: z.string().optional() }).nullable().optional(),
      experienceLevel: z.object({ id: z.string().optional() }).nullable().optional(),
    }),
  ),
});

// Ashby's public posting API. One request returns the entire board, so
// there is no offset/limit pair here the way SmartRecruiters has one.
//
// Every field below was present on all 1,223 postings sampled across six
// live boards (OpenAI, Linear, Ramp, Supabase, Replit, Cohere), but only
// id/title/jobUrl are required here: the rest are the ones an adapter can
// do without, and a board that omits one should still sync rather than
// fail shape validation outright.
export const ashbyResponseSchema = z.object({
  apiVersion: z.string().optional(),
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: z.string().nullable().optional(),
      // Additional places the same posting is open. Observed on 341 of the
      // 1,223 sampled, always as {location, address}.
      secondaryLocations: z
        .array(z.object({ location: z.string().nullable().optional() }))
        .nullable()
        .optional(),
      // "FullTime" | "PartTime" | "Intern" | "Contract" | "Temporary".
      employmentType: z.string().nullable().optional(),
      // "Remote" | "Hybrid" | "OnSite" | null. The sibling `isRemote`
      // boolean is deliberately NOT in this schema: see adapters/ashby.ts
      // for why reading it would mislabel every hybrid posting.
      workplaceType: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      isListed: z.boolean().optional(),
      descriptionPlain: z.string().nullable().optional(),
      descriptionHtml: z.string().nullable().optional(),
      jobUrl: z.string(),
    }),
  ),
});
