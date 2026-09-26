"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";
import { GitHubIcon, LinkedInIcon, YouTubeIcon } from "@/components/BrandIcons";
import { cn } from "@/lib/utils";

// The author's own profiles. An entry with an empty href is filtered out
// below, so blanking one removes its icon rather than shipping a dead link.
const SOCIAL_LINKS = [
  { label: "LinkedIn", href: "https://www.linkedin.com/in/piy777sus/", Icon: LinkedInIcon },
  { label: "GitHub", href: "https://github.com/Piyusss", Icon: GitHubIcon },
  { label: "YouTube", href: "https://www.youtube.com/@whyn0tdp/videos", Icon: YouTubeIcon },
];

const ACTIVE_SOCIALS = SOCIAL_LINKS.filter((s) => s.href.length > 0);

// Three steps, one line each: the whole explanation. Anything longer
// belongs in the product, not on the page in front of it.
//
// Each line states a mechanism rather than a benefit, and every number in
// them is real: sources are re-polled on their own pollIntervalSeconds
// (240s by default) by a worker ticking every 30s, matching gates on the
// six criteria in matching/predicate.ts, and the notification worker
// drains the send queue every 15s.
const STEPS = [
  { number: "01", title: "We Watch", body: "Company job boards, re-checked at the source every few minutes." },
  { number: "02", title: "We Match", body: "Each new opening is checked against all six of your preferences." },
  { number: "03", title: "You Apply Early", body: "An email lands within seconds of it going live, while the role is still new." },
];

// Every company here is one WatchmyJob.co genuinely monitors, and
// every recency string is a real output of `formatRecency`: the hero
// shouldn't be the one place in the product showing data it can't produce.
//
// `level` is always one of LEVEL_OPTIONS (lib/api.ts) and always appears as
// the title's prefix, because that is exactly how the classifier derives it
// from a board's raw title (sources/classify.ts reads seniority as a prefix,
// never a suffix). A card showing a level the title couldn't have produced
// would be fiction.
//
// Ordered newest first; the first entry is the expanded one.
const SAMPLE_JOBS = [
  { title: "Associate Software Engineer", company: "LinkedIn", domain: "linkedin.com", location: "Bengaluru", level: "Associate", type: "Full-time", recency: "New · 4 min ago" },
  { title: "Senior Backend Engineer", company: "Stripe", domain: "stripe.com", location: "Bengaluru", level: "Senior", type: "Full-time", recency: "New · 12 min ago" },
  { title: "Lead Product Designer", company: "Figma", domain: "figma.com", location: "Remote", level: "Lead", type: "Full-time", recency: "New · 26 min ago" },
  { title: "Staff Data Engineer", company: "Databricks", domain: "databricks.com", location: "Bengaluru", level: "Staff", type: "Full-time", recency: "New today · 1h ago" },
];

function PrimaryCta({ href = "/register", children }: { href?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-[0.95rem] font-semibold text-white shadow-brand transition-colors duration-200 hover:bg-brand-hover"
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * A deck of recent openings, tucked under one another so the stack reads as
 * a stream rather than a single lucky result. The top card is expanded; the
 * rest are inset and progressively dimmed so depth comes from the layering
 * itself, not from a drop shadow doing all the work.
 *
 * Deliberately NOT links: this illustrates the app rather than pretending
 * to be live listings.
 */
function SampleJobStack() {
  return (
    <div className="relative">
      <span className="sr-only">Examples of how fresh openings appear inside WatchmyJob.co:</span>

      {SAMPLE_JOBS.map((job, i) => {
        const expanded = i === 0;
        return (
          <div
            key={job.company}
            className={cn(
              "relative rounded-2xl border border-line bg-surface",
              expanded ? "p-5 shadow-lg" : "px-5 py-3.5 shadow-md",
            )}
            style={{
              // Later cards sit further back: lower in the paint order, tucked
              // up under the card above, and narrower on both sides.
              zIndex: SAMPLE_JOBS.length - i,
              marginTop: expanded ? 0 : -14,
              marginInline: i * 12,
              // Rounded rather than left as raw float arithmetic: 1 - 3*0.11
              // serialises as 0.6699999999999999 in the style attribute.
              opacity: Math.round((1 - i * 0.11) * 100) / 100,
            }}
          >
            <div className={cn("flex gap-3.5", expanded ? "items-start" : "items-center")}>
              <CompanyLogo name={job.company} domain={job.domain} size={expanded ? 42 : 34} />
              <div className="min-w-0 flex-1">
                <h3
                  className={cn(
                    "truncate font-semibold text-ink",
                    expanded ? "text-[1.02rem]" : "text-[0.9rem]",
                  )}
                >
                  {job.title}
                </h3>
                <p className={cn("mt-1 truncate text-ink-muted", expanded ? "text-[0.84rem]" : "text-[0.78rem]")}>
                  {job.company} · {job.location}
                </p>

                {/* Level and opportunity type, the same two fields JobCard
                    surfaces as its right-hand meta. Only on the expanded
                    card: on the collapsed rows the level is already
                    carried by the title's prefix. */}
                {expanded && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-brand-tint px-2 py-0.5 text-[0.7rem] font-semibold text-brand-ink">
                      {job.level}
                    </span>
                    <span className="rounded-md bg-tint px-2 py-0.5 text-[0.7rem] font-semibold text-warm-ink">
                      {job.type}
                    </span>
                  </div>
                )}
              </div>

              {/* Collapsed rows carry their own freshness inline: the whole
                  point of the stack is that every one of them is recent. */}
              {!expanded && (
                <span className="hidden shrink-0 text-[0.72rem] font-medium text-ink-faint sm:block">
                  {job.recency}
                </span>
              )}
            </div>

            {expanded && (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
                <span className="flex items-center gap-2 text-[0.8rem] font-medium text-ink-secondary">
                  <span className="size-2 shrink-0 rounded-full bg-[#16a34a]" />
                  {job.recency}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[0.8rem] font-semibold text-white">
                  Apply Now
                  <ArrowRight className="size-3.5" />
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const reduceMotion = useReducedMotion();

  // Hero elements arrive in reading order rather than all at once, so the
  // headline is legible before the stack beside it draws attention.
  const rise = (delay: number) => ({
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  const riseInView = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.25 },
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      {/* ------------------------------------------------------------- nav */}
      <nav className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur-md">
        <div className="container-wide flex h-16 items-center justify-between gap-4">
          <span className="flex shrink-0 items-center gap-2 text-[1rem] font-bold tracking-tight text-ink">
            <span className="grid size-6 place-items-center rounded-md bg-brand text-[0.68rem] font-bold text-white">
              W
            </span>
            WatchmyJob.co
          </span>

          {/* No "How it works" link here: the hero's secondary CTA already
              points at that section, and two links to one anchor in the same
              viewport reads as duplication rather than navigation. */}
          <div className="flex shrink-0 items-center gap-3 sm:gap-6">
            <Link href="/login" className="text-[0.85rem] font-medium text-ink transition-opacity hover:opacity-70">
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-brand px-3.5 py-2 text-[0.83rem] font-semibold text-white transition-colors hover:bg-brand-hover"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------------------ hero */}
      {/* Everything the page has to say lives above the fold: what it does,
          who it's for, what it looks like, and the one action to take.
          Laid out as two asymmetric columns: the pitch reads down the left
          edge, the product sits opposite it: rather than one centred
          stack, which is the layout every template defaults to. */}
      <header className="relative overflow-hidden pb-20 pt-16 sm:pb-24 sm:pt-24">
        {/* Ambient wash: blue behind the type, one soft pink counterweight
            behind the cards. Low-opacity blur only; nothing here competes
            with the headline. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-64 size-[44rem] rounded-full bg-brand-tint/60 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-44 -right-24 size-[32rem] rounded-full bg-tint/70 blur-3xl"
        />

        <div className="container-wide relative">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            {/* ---------------------------------------------- the pitch */}
            <div className="max-w-xl">
              <motion.h1
                {...rise(0)}
                className="text-[2.75rem] font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[3.7rem] lg:text-[4.15rem]"
              >
                Apply Early📜
                <br />
                Get Shortlisted.
              </motion.h1>

              <motion.p {...rise(0.06)} className="mt-6 text-[1.02rem] leading-[1.65] text-ink-muted sm:text-[1.06rem]">
                Get instant email alerts when a new job matching your preferences goes live so you can apply early before the crowd.
              </motion.p>

              <motion.p {...rise(0.09)} className="mt-3 text-[0.8rem] italic text-ink-faint">
                Note: This project is made for educational purposes by Piyush Raj.
              </motion.p>

              <motion.div {...rise(0.12)} className="mt-9 flex flex-wrap items-center gap-3">
                <PrimaryCta>Find Fresh Jobs</PrimaryCta>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-xl border border-line-strong bg-surface px-6 py-3.5 text-[0.95rem] font-semibold text-ink transition-colors duration-200 hover:border-brand/40 hover:bg-brand-tint/50"
                >
                  How It Works
                </a>
              </motion.div>

            </div>

            {/* ------------------------------------------- the product */}
            <motion.div {...rise(0.14)} className="w-full max-w-md lg:ml-auto lg:mr-0">
              <SampleJobStack />
            </motion.div>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------- how it works */}
      <section id="how-it-works" className="scroll-mt-16 border-t border-line py-20 sm:py-24">
        <div className="container-wide">
          <motion.p {...riseInView} className="eyebrow">
            How it works
          </motion.p>

          {/* Hairline dividers from a 1px gap over a line-coloured ground.
              With exactly three cells the row always fills, so the ground is
              never left showing as an empty block. */}
          <motion.div
            {...riseInView}
            transition={{ ...riseInView.transition, delay: 0.06 }}
            className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3"
          >
            {STEPS.map((step) => (
              <div key={step.number} className="bg-surface p-7 transition-colors duration-200 hover:bg-brand-tint/25 sm:p-8">
                <span className="text-[0.8rem] font-bold tabular-nums tracking-[0.12em] text-brand">{step.number}</span>
                <h3 className="mt-4 text-[1.15rem] font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-muted">{step.body}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* --------------------------------------------------------- closing */}
      <section className="relative overflow-hidden border-t border-line py-24 sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-52 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-brand-tint/60 blur-3xl"
        />

        <motion.div {...riseInView} className="container-wide relative text-center">
          <h2 className="mx-auto max-w-2xl text-[2.1rem] font-bold leading-[1.06] tracking-[-0.04em] text-ink sm:text-[2.9rem]">
            Don&apos;t Miss the Freshest Jobs.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[1rem] leading-[1.65] text-ink-muted">
            Find it early. Apply early. Give yourself a better shot at getting shortlisted
          </p>
          <div className="mt-9 flex justify-center">
            <PrimaryCta>Find Fresh Jobs</PrimaryCta>
          </div>
        </motion.div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-line">
        <div className="container-wide flex flex-col items-center justify-between gap-3 py-7 sm:flex-row">
          <span className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink">
            <span className="grid size-5 place-items-center rounded bg-brand text-[0.6rem] font-bold text-white">W</span>
            WatchmyJob.co
          </span>
          <div className="flex items-center gap-5 text-[0.83rem] text-ink-muted sm:gap-6">
            <Link href="/login" className="transition-colors hover:text-ink">
              Log in
            </Link>
            <Link href="/register" className="transition-colors hover:text-ink">
              Create account
            </Link>

            {ACTIVE_SOCIALS.length > 0 && (
              <>
                <span aria-hidden className="h-4 w-px bg-line" />
                <div className="flex items-center gap-0.5">
                  {ACTIVE_SOCIALS.map(({ label, href, Icon }) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={label}
                      className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-brand-tint hover:text-brand-ink"
                    >
                      <Icon className="size-4" />
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
