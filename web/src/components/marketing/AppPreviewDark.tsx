import { Bell, Bookmark, Briefcase, Building2, ChevronRight, Search, SlidersHorizontal } from "lucide-react";

// Company marks are letter tiles in each brand's rough hue rather than real
// brand logo files: at this size they read identically, and it avoids
// shipping third-party trademarks into the bundle or implying any of these
// companies endorse JobDrop.
const JOBS = [
  {
    title: "Senior Software Engineer, Payments",
    company: "Figma",
    location: "Bengaluru, India",
    years: "2-4 years",
    ago: "12 min ago",
    isNew: true,
    mark: { bg: "#2c1c2e", fg: "#f24e1e", letter: "F" },
  },
  {
    title: "Software Engineer, Infrastructure",
    company: "Stripe",
    location: "San Francisco, CA",
    years: "3-6 years",
    ago: "28 min ago",
    isNew: true,
    mark: { bg: "#1b2338", fg: "#7a9bff", letter: "S" },
  },
  {
    title: "Data Engineer",
    company: "Databricks",
    location: "Amsterdam",
    years: "3+ years",
    ago: "1 hour ago",
    isNew: false,
    mark: { bg: "#331c1a", fg: "#ff5a3d", letter: "D" },
  },
  {
    title: "Product Engineer",
    company: "Notion",
    location: "San Francisco, CA",
    years: "1-3 years",
    ago: "2 hours ago",
    isNew: false,
    mark: { bg: "#232323", fg: "#e8e8e8", letter: "N" },
  },
];

// The sidebar mirrors the product's real navigation. "Saved" and
// "Notifications" are shown greyed and marked as upcoming rather than
// presented as working features -- a marketing shot shouldn't advertise
// screens that don't exist yet.
const NAV = [
  { icon: Briefcase, label: "Jobs", active: true, soon: false },
  { icon: Building2, label: "Companies", active: false, soon: false },
  { icon: Bookmark, label: "Saved", active: false, soon: true },
  { icon: SlidersHorizontal, label: "Preferences", active: false, soon: false },
  { icon: Bell, label: "Notifications", active: false, soon: true },
];

export default function AppPreviewDark() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border border-lp-line bg-lp-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] select-none"
    >
      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-[8.5rem] shrink-0 border-r border-lp-line bg-lp-bg-2 p-3 sm:block">
          <div className="flex items-center gap-1.5 px-1 pb-3">
            <span className="grid size-4 place-items-center rounded bg-lp-accent text-[0.5rem] font-bold text-white">
              J
            </span>
            <span className="text-[0.68rem] font-semibold text-lp-text">JobDrop</span>
          </div>
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.label}>
                <span
                  className={
                    item.active
                      ? "flex items-center gap-1.5 rounded-md bg-lp-surface-2 px-2 py-1.5 text-[0.66rem] font-medium text-lp-text"
                      : "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.66rem] " +
                        (item.soon ? "text-lp-faint/70" : "text-lp-muted")
                  }
                >
                  <item.icon className="size-3" />
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b border-lp-line px-4 py-3">
            <span className="text-[0.78rem] font-semibold text-lp-text">Jobs that match you</span>
            <span className="rounded-full bg-lp-accent/15 px-2 py-0.5 text-[0.62rem] font-semibold text-lp-accent">
              12 new
            </span>
          </div>

          <div className="flex items-center gap-1.5 border-b border-lp-line px-4 py-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-lp-line bg-lp-bg-2 px-2 py-1">
              <Search className="size-3 shrink-0 text-lp-faint" />
              <span className="truncate text-[0.62rem] text-lp-faint">Search title, company or location…</span>
            </div>
            {["Remote", "Full-time", "Newest"].map((chip) => (
              <span
                key={chip}
                className="hidden shrink-0 items-center gap-1 rounded-md border border-lp-line bg-lp-bg-2 px-2 py-1 text-[0.62rem] text-lp-muted md:inline-flex"
              >
                {chip}
                <svg viewBox="0 0 8 5" className="size-1.5 fill-current opacity-60">
                  <path d="M0 0h8L4 5z" />
                </svg>
              </span>
            ))}
          </div>

          <ul className="divide-y divide-lp-line">
            {JOBS.map((job) => (
              <li key={job.title} className="flex items-center gap-2.5 px-4 py-3">
                <span className="w-8 shrink-0">
                  {job.isNew && (
                    <span className="rounded bg-lp-accent/15 px-1.5 py-0.5 text-[0.5rem] font-bold uppercase tracking-wide text-lp-accent">
                      New
                    </span>
                  )}
                </span>

                <span
                  className="grid size-6 shrink-0 place-items-center rounded-md text-[0.6rem] font-bold"
                  style={{ background: job.mark.bg, color: job.mark.fg }}
                >
                  {job.mark.letter}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.72rem] font-medium text-lp-text">{job.title}</span>
                  <span className="block truncate text-[0.62rem] text-lp-faint">
                    {job.company} · {job.location}
                  </span>
                </span>

                <span className="hidden shrink-0 flex-col items-end lg:flex">
                  <span className="text-[0.62rem] text-lp-muted">{job.years}</span>
                  <span className="text-[0.58rem] text-lp-faint">{job.ago}</span>
                </span>

                <ChevronRight className="size-3 shrink-0 text-lp-faint" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
