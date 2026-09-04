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
