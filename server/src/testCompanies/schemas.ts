import { z } from "zod";
import { LEVEL_VALUES, locationInputSchema } from "../preferences/schemas.js";

const WORK_MODE_VALUES = ["REMOTE", "HYBRID", "ON_SITE"] as const;
const OPPORTUNITY_TYPE_VALUES = ["FULL_TIME", "INTERNSHIP", "CONTRACT", "PART_TIME", "OTHER"] as const;
const MAX_LOCATIONS = 10;

// Same convention as admin/companies.ts's CLI: kept here rather than
// imported from it, since that file is a standalone script (own main()/
// process.exit()), not a module meant to be imported by the HTTP server.
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const createTestCompanySchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Optional: routes.ts falls back to slugify(name) when omitted, applying
  // the same slugify() to whichever string wins so the two paths can't
  // diverge in behavior.
  slug: z.string().trim().min(1).max(80).optional(),
  // "Logo URL" in custom_company.txt's own field list, but this app has no
  // concept of a directly-stored logo URL for any company, real or test:
  // CompanyLogo.tsx derives one from `domain` via the same icon service
  // every real company uses, falling back to an initials avatar when domain
  // is null (see Company.domain's own schema comment). Reusing that exact
  // mechanism here, rather than inventing a parallel one, is what "reuse
  // the existing Company entity" (Section 3) actually asks for: a test
  // company with no real domain just gets the same graceful fallback a real
  // company without one already gets.
  domain: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null)),
});

export const updateTestCompanyStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export const createTestJobSchema = z
  .object({
    // Free text, deliberately: what shows as the posting's headline on the
    // dashboard/detail pages. Not required to literally equal
    // "{level} {roleFamily}": a real job's title and its classified
    // role/level don't always line up either (see classify.ts).
    title: z.string().trim().min(1).max(300),
    // Sourced from the SAME live /api/jobs/role-families vocabulary the
    // preferences form's RoleFamilySelect uses, and validated the same way
    // server-side (see routes.ts): no independent value set for test jobs
    // (Section 6's explicit rule), even though this sets Job.roleFamily
    // directly rather than being parsed back out of the title.
    roleFamily: z.string().trim().min(1).max(200),
    level: z.enum(LEVEL_VALUES).nullable().default(null),
    locations: z.array(locationInputSchema).max(MAX_LOCATIONS).default([]),
    workMode: z.enum(WORK_MODE_VALUES).nullable().default(null),
    opportunityType: z.enum(OPPORTUNITY_TYPE_VALUES).default("FULL_TIME"),
    requiredExperienceMin: z.number().int().min(0).max(60).nullable().default(null),
    requiredExperienceMax: z.number().int().min(0).max(60).nullable().default(null),
    description: z
      .string()
      .trim()
      .max(20000)
      .nullable()
      .optional()
      .transform((v) => v || null),
    applicationUrl: z.string().trim().url(),
  })
  .superRefine((input, ctx) => {
    if (
      input.requiredExperienceMin !== null &&
      input.requiredExperienceMax !== null &&
      input.requiredExperienceMax < input.requiredExperienceMin
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredExperienceMax"],
        message: "Max experience must be greater than or equal to min",
      });
    }
  });

export const updateTestJobSchema = createTestJobSchema;

export type CreateTestCompanyInput = z.infer<typeof createTestCompanySchema>;
export type CreateTestJobInput = z.infer<typeof createTestJobSchema>;
