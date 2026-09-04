import { z } from "zod";
import { findCountry, findState, isValidCity } from "../geo/data.js";

const WORK_MODE_VALUES = ["REMOTE", "HYBRID", "ON_SITE"] as const;
const OPPORTUNITY_TYPE_VALUES = ["FULL_TIME", "INTERNSHIP", "CONTRACT", "PART_TIME", "OTHER"] as const;

// Kept in sync with the frontend's own LEVEL_OPTIONS (PreferencesClient.tsx)
// by hand, the same way WORK_MODE_VALUES/OPPORTUNITY_TYPE_VALUES above are
// already duplicated between this file's zod schema and the frontend's
// WORK_MODES/OPPORTUNITY_TYPES arrays -- an established pattern in this
// codebase, not a new one, and small/stable enough not to warrant a shared
// package for two six-line lists.
const LEVEL_VALUES = ["Intern", "Associate", "Senior", "Lead", "Staff", "Principal"] as const;

const trimmedOrNull = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));

const MAX_LOCATIONS = 10;

// The wire format sends only codes for country/state -- the server derives
// the display names from the same curated list it validates against
// (geo/data.ts), so a stored name can never drift from what its code
// actually means. City has no separate code (it's a dataset leaf), so it's
// validated as an exact match against its state's known city list instead.
const locationInputSchema = z
  .object({
    countryCode: z.string().min(1),
    stateCode: z.string().min(1).nullable().default(null),
    cityName: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .superRefine((loc, ctx) => {
    const country = findCountry(loc.countryCode);
    if (!country) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["countryCode"], message: "Unknown country" });
      return;
    }
    if (loc.stateCode === null) {
      if (loc.cityName !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cityName"], message: "A city requires a state" });
      }
      return;
    }
    const state = findState(loc.countryCode, loc.stateCode);
    if (!state) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stateCode"], message: "Unknown state for this country" });
      return;
    }
    if (loc.cityName !== null && !isValidCity(loc.countryCode, loc.stateCode, loc.cityName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cityName"], message: "Unknown city for this state" });
    }
  });

export const preferencesSchema = z.object({
  roleFamily: trimmedOrNull,
  roleLevel: z.enum(LEVEL_VALUES).nullable().optional(),
  yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
  toleranceYears: z.number().int().min(0).max(20).nullable().optional(),
  locations: z.array(locationInputSchema).max(MAX_LOCATIONS).default([]),
  workMode: z.array(z.enum(WORK_MODE_VALUES)).default([]),
  opportunityTypes: z.array(z.enum(OPPORTUNITY_TYPE_VALUES)).default([]),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type LocationInput = z.infer<typeof locationInputSchema>;
