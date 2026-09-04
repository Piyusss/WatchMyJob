import { Bell, Check, ChevronRight, Mail, Search } from "lucide-react";

/* Shared chrome for every mockup: a dark inset panel with a faint top bar,
   matching the product-screenshot cards on the reference layout. */
function MockFrame({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-lp-line bg-lp-bg-2">
      <div className="flex items-center gap-2 border-b border-lp-line px-4 py-2.5">
        {icon}
        <span className="text-[0.72rem] font-medium text-lp-muted">{title}</span>
      </div>
      {children}
    </div>
  );
}

const WATCH_ROWS = [
  { company: "Stripe", detail: "612 open roles", state: "Checked 2 min ago", ok: true },
  { company: "Databricks", detail: "864 open roles", state: "Checked 3 min ago", ok: true },
  { company: "Figma", detail: "158 open roles", state: "Checked 4 min ago", ok: true },
  { company: "Cloudflare", detail: "329 open roles", state: "Checked 6 min ago", ok: true },
];

/** 01 — sources being polled. */
export function WatchMock() {
  return (
    <MockFrame title="Sources" icon={<span className="size-2 rounded-full bg-emerald-400/80" />}>
      <ul className="divide-y divide-lp-line">
        {WATCH_ROWS.map((row) => (
          <li key={row.company} className="flex items-center gap-3 px-4 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-lp-surface-2 text-[0.62rem] font-bold text-lp-muted">
              {row.company.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.75rem] font-medium text-lp-text">{row.company}</span>
              <span className="block truncate text-[0.65rem] text-lp-faint">{row.detail}</span>
            </span>
            <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-400/80" />
              <span className="text-[0.65rem] text-lp-faint">{row.state}</span>
            </span>
          </li>
        ))}
      </ul>
    </MockFrame>
  );
}

const CRITERIA = [
  { label: "Role", value: "Software Engineer", ok: true },
  { label: "Level", value: "Senior", ok: true },
  { label: "Experience", value: "5 yrs ± 2", ok: true },
  { label: "Location", value: "Bengaluru", ok: true },
  { label: "Work mode", value: "Remote", ok: true },
  { label: "Opportunity type", value: "Full-time", ok: true },
];

/** 02 — the six-dimension match check. */
export function MatchMock() {
  return (
    <MockFrame title="Match evaluation" icon={<Check className="size-3 text-lp-accent" />}>
      <div className="px-4 py-3">
        <p className="text-[0.75rem] font-medium text-lp-text">Senior Software Engineer, Payments</p>
        <p className="mt-0.5 text-[0.65rem] text-lp-faint">Stripe · Bengaluru, India</p>
      </div>
      <ul className="divide-y divide-lp-line border-t border-lp-line">
        {CRITERIA.map((c) => (
          <li key={c.label} className="flex items-center gap-3 px-4 py-2">
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-lp-accent">
              <Check className="size-2.5 text-white" strokeWidth={3} />
            </span>
            <span className="flex-1 text-[0.7rem] text-lp-muted">{c.label}</span>
            <span className="truncate text-[0.68rem] text-lp-faint">{c.value}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-lp-line px-4 py-2.5">
        <span className="text-[0.68rem] font-medium text-lp-accent">6 of 6 cleared — queued to send</span>
      </div>
    </MockFrame>
  );
}

/** 03 — the alert that actually lands. */
export function NotifyMock() {
  return (
    <MockFrame title="Inbox" icon={<Mail className="size-3 text-lp-muted" />}>
      <div className="px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-lp-accent text-[0.7rem] font-bold text-white">
            J
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.75rem] font-semibold text-lp-text">
              New role at Stripe matches your preferences
            </p>
            <p className="mt-0.5 text-[0.65rem] text-lp-faint">JobDrop · just now</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-lp-line bg-lp-surface p-3">
          <p className="text-[0.72rem] font-medium text-lp-text">Senior Software Engineer, Payments</p>
          <p className="mt-0.5 text-[0.64rem] text-lp-faint">Stripe · Bengaluru, India · Remote · 5+ yrs</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[0.62rem] font-semibold text-black">
            View role
            <ChevronRight className="size-2.5" />
          </span>
        </div>

        <p className="mt-3 text-[0.62rem] text-lp-faint">
          Sent once. Never re-sent, even if the posting is re-checked.
        </p>
      </div>
    </MockFrame>
  );
}

const JOB_ROWS = [
  { title: "Senior Software Engineer, Payments", meta: "Stripe · Bengaluru, India", right: "5+ yrs", isNew: true },
  { title: "Software Engineer, Infrastructure", meta: "Cloudflare · London", right: "3-6 yrs", isNew: true },
  { title: "Data Engineer", meta: "Databricks · Amsterdam", right: "3+ yrs", isNew: false },
  { title: "Product Engineer", meta: "Figma · San Francisco, CA", right: "1-3 yrs", isNew: false },
];

/** Hero shot — the dashboard itself. */
export function DashboardMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-lp-line bg-lp-bg-2 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
      <div className="flex items-center justify-between border-b border-lp-line px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded bg-lp-accent text-[0.6rem] font-bold text-white">
            J
          </span>
          <span className="text-[0.75rem] font-semibold text-lp-text">Jobs that match you</span>
        </span>
        <span className="rounded-full bg-lp-accent/15 px-2 py-0.5 text-[0.6rem] font-semibold text-lp-accent-2">
          12 new
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-b border-lp-line px-4 py-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-lp-line bg-lp-surface px-2 py-1">
          <Search className="size-3 shrink-0 text-lp-faint" />
          <span className="truncate text-[0.62rem] text-lp-faint">Search title, company or location…</span>
        </span>
        {["Remote", "Full-time"].map((chip) => (
          <span
            key={chip}
            className="hidden shrink-0 rounded-md border border-lp-line bg-lp-surface px-2 py-1 text-[0.62rem] text-lp-muted sm:inline"
          >
            {chip}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-lp-line">
        {JOB_ROWS.map((job) => (
          <li key={job.title} className="flex items-center gap-2.5 px-4 py-3">
            <span className="w-7 shrink-0">
              {job.isNew && (
                <span className="rounded bg-lp-accent/15 px-1.5 py-0.5 text-[0.5rem] font-bold uppercase tracking-wide text-lp-accent-2">
                  New
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.73rem] font-medium text-lp-text">{job.title}</span>
              <span className="block truncate text-[0.63rem] text-lp-faint">{job.meta}</span>
            </span>
            <span className="hidden shrink-0 text-[0.63rem] text-lp-muted sm:block">{job.right}</span>
            <ChevronRight className="size-3 shrink-0 text-lp-faint" />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 border-t border-lp-line px-4 py-2.5">
        <Bell className="size-3 text-lp-accent" />
        <span className="text-[0.63rem] text-lp-faint">You&apos;ll be emailed the moment a new match appears.</span>
      </div>
    </div>
  );
}
