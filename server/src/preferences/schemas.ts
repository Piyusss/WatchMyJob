import { z } from "zod";

const WORK_MODE_VALUES = ["REMOTE", "HYBRID", "ON_SITE"] as const;
const OPPORTUNITY_TYPE_VALUES = ["FULL_TIME", "INTERNSHIP", "CONTRACT", "PART_TIME", "OTHER"] as const;

const trimmedOrNull = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));

export const preferencesSchema = z.object({
  roleFamily: trimmedOrNull,
  roleLevel: trimmedOrNull,
  yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
  toleranceYears: z.number().int().min(0).max(20).nullable().optional(),
  country: trimmedOrNull,
  state: trimmedOrNull,
  city: trimmedOrNull,
  workMode: z.array(z.enum(WORK_MODE_VALUES)).default([]),
  opportunityTypes: z.array(z.enum(OPPORTUNITY_TYPE_VALUES)).default([]),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
