import Link from "next/link";
import { Check } from "lucide-react";

const HIGHLIGHTS = [
  "Openings from 13 companies, checked continuously at the source.",
  "Alerts only for genuinely new roles — never the backlog, never twice.",
  "Free for candidates. No card, no catch.",
];

// Split layout: a warm brand panel carrying the promise, and a quiet
// surface carrying the form. The panel is decorative on small screens --
// it collapses to a compact header rather than eating the first screenful
// above the fields people came here to fill in.
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="relative overflow-hidden bg-brand px-6 py-8 text-white lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:px-14 lg:py-0">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-[26rem] rounded-full bg-white/[0.06] blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-[22rem] rounded-full bg-white/[0.05] blur-2xl"
        />

        <div className="relative">
          <Link href="/" className="flex w-fit items-center gap-2 text-[1.05rem] font-bold tracking-tight text-white">
            <span className="grid size-6 place-items-center rounded-md bg-white/15 text-[0.7rem] font-bold">G</span>
            GettingShortlisted.com
          </Link>

          <h2 className="mt-8 hidden max-w-md font-display text-[2.1rem] leading-[1.15] text-white lg:block">
            The job you want, the hour it opens.
          </h2>

          <ul className="mt-8 hidden max-w-sm flex-col gap-3.5 lg:flex">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-[0.9rem] leading-relaxed text-white/85">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white/15">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex flex-1 items-center justify-center bg-canvas px-5 py-10 sm:px-6 lg:py-0">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
