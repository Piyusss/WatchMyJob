import { BadgeCheck, Check, ChevronRight, Search } from "lucide-react";

const PREVIEW_JOBS = [
  {
    title: "Senior Software Engineer, Payments",
    company: "Stripe",
    meta: "Bengaluru · Remote",
    right: "Senior · Full-time",
    sub: "4+ yrs · 12 min ago",
    isNew: true,
  },
  {
    title: "Software Engineer, Data Platform",
    company: "Databricks",
    meta: "Amsterdam",
    right: "Full-time",
    sub: "3+ yrs · 1h ago",
    isNew: true,
  },
  { title: "Product Engineer", company: "Figma", meta: "San Francisco, CA", right: "Full-time", sub: "2d ago" },
  { title: "Backend Engineer, Core", company: "Cloudflare", meta: "London", right: "Full-time", sub: "3d ago" },
];

// A faithful-but-static rendering of the real product surface, built from
// the same design tokens as the app itself -- so the marketing preview
// can't drift into showing a product that doesn't exist. Decorative:
// hidden from assistive tech, which gets the surrounding prose instead.
export default function AppPreview() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg select-none"
    >
      <div className="flex items-center gap-2 border-b border-line bg-canvas/70 px-4 py-2.5">
        <span className="grid size-5 place-items-center rounded bg-brand text-[0.6rem] font-bold text-white">J</span>
        <span className="text-[0.72rem] font-semibold text-ink">Jobs that match you</span>
        <span className="ml-auto rounded-full bg-brand-tint px-2 py-0.5 text-[0.62rem] font-semibold text-brand-ink">
          12 new
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-line px-2 py-1">
          <Search className="size-3 text-ink-faint" />
          <span className="text-[0.66rem] text-ink-faint">Search title, company, location…</span>
        </div>
        <span className="rounded-md border border-line px-2 py-1 text-[0.66rem] text-ink-muted">Remote</span>
        <span className="hidden rounded-md border border-line px-2 py-1 text-[0.66rem] text-ink-muted sm:inline">
          Newest
        </span>
      </div>

      <ul className="divide-y divide-line">
        {PREVIEW_JOBS.map((job) => (
          <li key={job.title} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {job.isNew && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-tint px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-brand-ink">
                    <span className="size-1 rounded-full bg-brand" />
                    New
                  </span>
                )}
                <span className="truncate text-[0.75rem] font-medium text-ink">{job.title}</span>
              </div>
              <div className="mt-0.5 truncate text-[0.66rem] text-ink-muted">
                <span className="text-ink-secondary">{job.company}</span> · {job.meta}
              </div>
            </div>
            <div className="hidden shrink-0 flex-col items-end sm:flex">
              <span className="text-[0.66rem] text-ink-secondary">{job.right}</span>
              <span className="text-[0.6rem] text-ink-faint">{job.sub}</span>
            </div>
            <ChevronRight className="size-3 shrink-0 text-ink-faint" />
          </li>
        ))}
      </ul>

      <div className="border-t border-line bg-gradient-to-br from-brand-tint to-surface px-4 py-3">
        <div className="flex items-center gap-1.5">
          <BadgeCheck className="size-3 text-brand" />
          <span className="text-[0.66rem] font-semibold text-brand-ink">Why this matches you</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {["Role", "Experience", "Location", "Work mode"].map((label) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="grid size-3 place-items-center rounded-full bg-brand text-white">
                <Check className="size-2" strokeWidth={4} />
              </span>
              <span className="text-[0.66rem] text-ink-secondary">{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
