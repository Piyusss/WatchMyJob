import { Check, X, BadgeCheck } from "lucide-react";
import type { MatchExplanation } from "@/lib/api";
import { cn } from "@/lib/utils";

const CRITERIA: { key: keyof Omit<MatchExplanation, "overallMatch">; label: string }[] = [
  { key: "roleMatched", label: "Role" },
  { key: "levelMatched", label: "Level" },
  { key: "experienceMatched", label: "Experience" },
  { key: "locationMatched", label: "Location" },
  { key: "workModeMatched", label: "Work mode" },
  { key: "opportunityTypeMatched", label: "Opportunity type" },
];

// A matched job has every dimension true by construction --
// getMatchExplanation ANDs them all (see matching/predicate.ts). Shown as
// one line per dimension rather than a single "it matched" statement, so
// the reasoning is legible instead of asserted.
export default function WhyThisMatches({ explanation }: { explanation: MatchExplanation }) {
  return (
    <section
      aria-label="Why this job matches your preferences"
      className="overflow-hidden rounded-xl border border-brand-tint-strong bg-gradient-to-br from-brand-tint to-surface"
    >
      <header className="flex items-center gap-2 border-b border-brand-tint-strong/70 px-5 py-3">
        <BadgeCheck className="size-4 text-brand" />
        <h2 className="text-[0.82rem] font-semibold text-brand-ink">Why this matches you</h2>
      </header>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 px-5 py-4 sm:grid-cols-3">
        {CRITERIA.map(({ key, label }) => {
          const matched = explanation[key];
          return (
            <li key={key} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full",
                  matched ? "bg-brand text-white" : "bg-tint-strong text-ink-faint",
                )}
              >
                {matched ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
              </span>
              <span className={cn("text-[0.82rem]", matched ? "text-ink-secondary" : "text-ink-faint")}>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
