import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { JobListing } from "@/lib/api";
import { OPPORTUNITY_LABEL, experienceLabel } from "@/lib/jobDisplay";
import { formatRecency } from "@/lib/recency";
import { cn } from "@/lib/utils";

// One row in a divided list, not a standalone card. Metadata is carried by
// type weight, color and position rather than by giving every field its own
// badge -- twenty rows of five badges each is noise, and it flattens the
// hierarchy so nothing reads as important.
export default function JobCard({ job }: { job: JobListing }) {
  const expLabel = experienceLabel(job);
  const recency = formatRecency(job.firstSeenAt);

  // A baseline job (inventory that already existed when this user started
  // watching) is never labelled "new", however recently JobDrop first
  // indexed it -- discovery time is not the same thing as the opening being
  // new to this user, and conflating them is exactly the mislabelling the
  // "already open" concept exists to prevent.
  const showAsNew = recency.isNew && !job.discoveredInInitialSync;

  const rightMeta = [job.level, OPPORTUNITY_LABEL[job.opportunityType]].filter(Boolean).join(" · ");

  return (
    <Link href={`/jobs/${job.id}`} className="list-row list-row-interactive group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {showAsNew && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[0.66rem] font-semibold uppercase tracking-wide text-brand-ink">
              <span className="size-1.5 rounded-full bg-brand" />
              New
            </span>
          )}
          <h3 className="truncate text-[0.925rem] font-medium text-ink transition-colors group-hover:text-brand-ink">
            {job.title}
          </h3>
        </div>

        <p className="mt-1 truncate text-[0.8rem] text-ink-muted">
          <span className="text-ink-secondary">{job.company.name}</span>
          {job.location ? ` · ${job.location}` : ""}
          {job.workMode === "REMOTE" ? " · Remote" : ""}
        </p>
      </div>

      {/* The second line deliberately omits any "already open" marker: the
          list header already states how many of these predate the user's
          subscription, and repeating it on every row (often every row in
          the list) is noise that competes with the New pill -- which is the
          signal that actually matters here. Absence of the pill is the
          contrast. */}
      <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right sm:flex">
        {rightMeta && <span className="text-[0.78rem] text-ink-secondary">{rightMeta}</span>}
        {(expLabel || !job.discoveredInInitialSync) && (
          <span className={cn("text-[0.72rem]", showAsNew ? "text-brand" : "text-ink-faint")}>
            {[expLabel, job.discoveredInInitialSync ? null : recency.label].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>

      <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted" />
    </Link>
  );
}
