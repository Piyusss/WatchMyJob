import type { JobListing, OpportunityType } from "@/lib/api";

export const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  FULL_TIME: "Full-time",
  INTERNSHIP: "Internship",
  CONTRACT: "Contract",
  PART_TIME: "Part-time",
  OTHER: "Other",
};

export function experienceLabel(job: Pick<JobListing, "experienceStatus" | "requiredExperienceMin" | "requiredExperienceMax">): string | null {
  if (job.experienceStatus === "UNKNOWN") return null;
  const { requiredExperienceMin: min, requiredExperienceMax: max } = job;
  if (min !== null && max !== null) return `${min}–${max} yrs`;
  if (min !== null) return `${min}+ yrs`;
  return null;
}
