"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Bell, Radar, Search, SlidersHorizontal } from "lucide-react";
import PixelGrid from "@/components/marketing/PixelGrid";
import PersonaSwitcher from "@/components/marketing/PersonaSwitcher";
import { DashboardMock, MatchMock, NotifyMock, WatchMock } from "@/components/marketing/DarkMockups";

const COMPANIES = [
  "Stripe",
  "Airbnb",
  "Databricks",
  "Cloudflare",
  "LinkedIn",
  "Spotify",
  "Dropbox",
  "Figma",
  "Rubrik",
  "Zscaler",
  "Postman",
  "Discord",
  "Palantir",
];

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#who-its-for", label: "Who it's for" },
  { href: "#companies", label: "Companies" },
];

const FACTS = [
  { value: "13", label: "Company boards watched" },
  { value: "3,200+", label: "Open roles tracked" },
  { value: "6", label: "Match criteria per alert" },
];

/** White pill — the primary action, as on the reference. */
function PrimaryCta({ children, href = "/register" }: { children: React.ReactNode; href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-[0.875rem] font-semibold text-black transition-colors hover:bg-white/85"
    >
      {children}
    </Link>
  );
}

/** Dark pill — the secondary action. */
function SecondaryCta({ children, href = "/login" }: { children: React.ReactNode; href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg border border-lp-line-2 bg-lp-surface-2 px-4 py-2.5 text-[0.875rem] font-semibold text-lp-text transition-colors hover:bg-lp-line"
    >
      {children}
    </Link>
  );
}

/** The numbered chapter header used by each stage of the pipeline. */
function ChapterHeading({
  word,
  number,
  title,
  body,
}: {
  word: string;
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-xl">
      <h2 className="flex items-start gap-1.5 text-[2.6rem] font-bold leading-none tracking-[-0.04em] text-lp-text sm:text-[3.2rem]">
        {word}
        <sup className="mt-1 text-[0.9rem] font-semibold tracking-normal text-lp-accent sm:text-[1.05rem]">
          {number}
        </sup>
      </h2>
      <h3 className="mt-6 text-[1.05rem] font-semibold text-lp-text sm:text-[1.15rem]">{title}</h3>
      <p className="mt-3 text-[0.95rem] leading-[1.7] text-lp-muted">{body}</p>
      <div className="mt-7 flex flex-wrap gap-2.5">
        <PrimaryCta>Create your free account</PrimaryCta>
        <SecondaryCta>Log in</SecondaryCta>
      </div>
    </div>
  );
}

/** Caption under a product shot: coloured icon tile, name, one line. */
function MockCaption({
  icon,
  tint,
  name,
  body,
}: {
  icon: React.ReactNode;
  tint: string;
  name: string;
  body: string;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-md" style={{ background: tint }}>
          {icon}
        </span>
        <span className="text-[1rem] font-semibold text-lp-text">{name}</span>
      </div>
      <p className="mt-2.5 max-w-md text-[0.88rem] leading-relaxed text-lp-muted">{body}</p>
    </div>
  );
}

export default function HomePage() {
  const reduceMotion = useReducedMotion();

  const fadeUp = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0 as const, margin: "240px 0px 240px 0px" },
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-lp-bg text-lp-text">
      {/* ------------------------------------------------------------- nav */}
      <nav className="sticky top-0 z-40 border-b border-lp-line/60 bg-lp-bg/85 backdrop-blur-lg">
        <div className="container-wide flex h-16 items-center justify-between gap-4">
          <span className="flex shrink-0 items-center gap-2 text-[1rem] font-bold tracking-tight text-lp-text">
            <span className="grid size-6 place-items-center rounded-md bg-white text-[0.68rem] font-bold text-black">
              G
            </span>
            GettingShortlisted.com
          </span>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[0.85rem] font-medium text-lp-muted transition-colors hover:text-lp-text"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/login"
              className="text-[0.85rem] font-medium text-lp-text transition-opacity hover:opacity-70"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-white px-3.5 py-2 text-[0.83rem] font-semibold text-black transition-colors hover:bg-white/85"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------------------ hero */}
      <header className="relative overflow-hidden pb-20 pt-16 sm:pt-24">
        {/* Clustered at the edges, well clear of the centred headline --
            texture framing the type, not a backdrop behind it. */}
        <PixelGrid seed={11} count={12} className="-left-20 top-0" />
        <PixelGrid seed={29} count={12} className="-right-14 top-6" />
        <PixelGrid seed={53} count={10} className="-left-14 bottom-0" />
        <PixelGrid seed={97} count={11} className="-right-20 bottom-8" />

        <div className="container-wide relative text-center">
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Factual counts rather than review-site badges -- GettingShortlisted.com has
                no G2/Capterra presence, and inventing rating stars would be
                fabricated social proof. */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              {FACTS.map((f) => (
                <span key={f.label} className="flex items-baseline gap-2">
                  <span className="text-[0.95rem] font-bold tabular-nums text-lp-text">{f.value}</span>
                  <span className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-lp-faint">
                    {f.label}
                  </span>
                </span>
              ))}
            </div>

            <h1 className="mx-auto mt-9 max-w-5xl text-[3rem] font-bold leading-[0.98] tracking-[-0.045em] text-lp-text sm:text-[4.6rem] lg:text-[5.8rem]">
              Real openings,
              <br />
              not{" "}
              {/* 3D keycap, built in CSS -- the reference's inline object */}
              <span className="relative -mb-[0.08em] mx-1 inline-grid size-[0.86em] place-items-center rounded-[0.17em] bg-[#1f38c4] align-middle shadow-[0_0.075em_0_#152586,0_0.16em_0.24em_rgba(0,0,0,0.75)] sm:mx-3">
                <span className="grid size-[0.8em] place-items-center rounded-[0.13em] bg-gradient-to-b from-[#6b85ff] to-[#3355ee]">
                  <Bell className="size-[0.4em] text-white" strokeWidth={2.5} />
                </span>
              </span>{" "}
              <span className="font-pixel text-[0.86em] font-bold tracking-[-0.02em]">noise</span>
            </h1>

            <p className="mx-auto mt-8 max-w-xl text-[1rem] leading-[1.7] text-lp-muted">
              GettingShortlisted.com watches company career pages directly and emails you the moment a role appears that matches your
              experience, location and preferences. Every alert is checked against six criteria before it&apos;s sent.
            </p>

            <div className="mt-9 flex flex-wrap justify-center gap-2.5">
              <PrimaryCta>Create your free account</PrimaryCta>
              <SecondaryCta>Log in</SecondaryCta>
            </div>
          </motion.div>
        </div>

        {/* logo wall */}
        <div className="container-wide relative mt-24">
          <p className="text-center text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-lp-faint">
            Monitoring open roles at
          </p>
          <div className="relative mt-7 overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-lp-bg to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-lp-bg to-transparent" />
            <motion.div
              className="flex w-max items-center gap-10 sm:gap-12"
              animate={reduceMotion ? undefined : { x: ["0%", "-50%"] }}
              transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
            >
              {[...COMPANIES, ...COMPANIES].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="shrink-0 whitespace-nowrap text-[1rem] font-semibold tracking-tight text-lp-muted/55"
                >
                  {name}
                </span>
              ))}
            </motion.div>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------ hero product shot */}
      <section className="container-wide pb-24">
        <motion.div {...fadeUp}>
          <DashboardMock />
        </motion.div>
      </section>

      {/* ------------------------------------------------------------ 01 watch */}
      <section id="how-it-works" className="relative scroll-mt-20 border-t border-lp-line py-20 sm:py-28">
        <PixelGrid seed={17} count={16} className="-right-20 top-8 opacity-50" />
        <div className="container-wide relative">
          <motion.div {...fadeUp}>
            <ChapterHeading
              word="Watch"
              number="01"
              title="Company career pages, checked continuously"
              body="Pick the companies you'd actually move for. GettingShortlisted.com polls each one's board directly at the source — no aggregator middle-man, no weekly scrape — and knows within minutes when something appears or disappears."
            />
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }} className="mt-14 max-w-4xl">
            <WatchMock />
            <MockCaption
              icon={<Radar className="size-3.5 text-white" />}
              tint="#7c3aed"
              name="Live source monitoring"
              body="Every source reports its own health. A board that breaks is visibly broken, not silently empty."
            />
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 02 match */}
      <section className="relative border-t border-lp-line py-20 sm:py-28">
        <PixelGrid seed={41} count={16} className="-left-24 top-16 opacity-50" />
        <div className="container-wide relative">
          <motion.div {...fadeUp}>
            <ChapterHeading
              word="Match"
              number="02"
              title="Six criteria, checked before anything is sent"
              body="Role, level, experience, location, work mode and opportunity type — each evaluated separately, all six required. An internship never arrives because a year-count overlapped, and a staff role never arrives because your tolerance window brushed its floor."
            />
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }} className="mt-14 max-w-4xl">
            <MatchMock />
            <MockCaption
              icon={<SlidersHorizontal className="size-3.5 text-white" />}
              tint="#db2777"
              name="Why this matches"
              body="Open any role and see exactly which criteria it cleared — the same evaluation that decided to email you, not a guess reconstructed afterwards."
            />
          </motion.div>
        </div>
      </section>

      {/* ----------------------------------------------------------- 03 notify */}
      <section className="relative border-t border-lp-line py-20 sm:py-28">
        <PixelGrid seed={73} count={16} className="-right-16 bottom-10 opacity-50" />
        <div className="container-wide relative">
          <motion.div {...fadeUp}>
            <ChapterHeading
              word="Notify"
              number="03"
              title="One email, the moment it matters"
              body="Roles already open when you start watching stay visible in the app but never reach your inbox. Each genuine match emails you exactly once. A role that disappears from the source is confirmed gone across several checks before it closes."
            />
          </motion.div>

          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.08 }} className="mt-14 max-w-3xl">
            <NotifyMock />
            <MockCaption
              icon={<Bell className="size-3.5 text-white" />}
              tint="#2563eb"
              name="Quiet by design"
              body="No backlog on day one, no duplicates, no alerts for roles that have already closed."
            />
          </motion.div>
        </div>
      </section>

      {/* -------------------------------------------------------- who it's for */}
      <section id="who-its-for" className="relative scroll-mt-20 border-t border-lp-line py-20 sm:py-28">
        <PixelGrid seed={131} count={14} className="-left-20 bottom-0 opacity-45" />
        <div className="container-wide relative">
          <motion.div {...fadeUp}>
            <PersonaSwitcher />
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------ companies */}
      <section id="companies" className="relative scroll-mt-20 border-t border-lp-line py-20 sm:py-24">
        <div className="container-wide">
          <motion.div {...fadeUp} className="max-w-xl">
            <h2 className="text-[2rem] font-bold leading-tight tracking-[-0.03em] text-lp-text sm:text-[2.4rem]">
              Thirteen companies, watched at the source.
            </h2>
            <p className="mt-4 text-[0.95rem] leading-[1.7] text-lp-muted">
              Each of these publishes a public job board that GettingShortlisted.com reads directly and re-checks continuously. More
              are added as their boards become reliably readable.
            </p>
          </motion.div>

          {/* Per-cell borders rather than a gap-px grid over a coloured
              background: with 14 items in a 4-column grid the final row is
              short, and the gap technique would expose the background as a
              large empty block where those cells would have been. */}
          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.06 }} className="mt-10">
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-lp-line sm:grid-cols-3 lg:grid-cols-4">
              {COMPANIES.map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-3 border-b border-r border-lp-line px-5 py-5"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-lp-surface-2 text-[0.66rem] font-bold text-lp-muted">
                    {name.charAt(0)}
                  </span>
                  <span className="truncate text-[0.9rem] font-medium text-lp-text">{name}</span>
                </div>
              ))}
              <div className="flex items-center border-b border-r border-lp-line px-5 py-5">
                <span className="text-[0.85rem] text-lp-faint">More on the way</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* --------------------------------------------------------- closing cta */}
      <section className="relative overflow-hidden border-t border-lp-line py-24 sm:py-32">
        <PixelGrid seed={181} count={20} className="-left-16 top-4 opacity-50" />
        <PixelGrid seed={211} count={20} className="-right-20 bottom-0 opacity-50" />
        <motion.div {...fadeUp} className="container-wide relative text-center">
          <h2 className="mx-auto max-w-3xl text-[2.3rem] font-bold leading-[1.03] tracking-[-0.04em] text-lp-text sm:text-[3.4rem]">
            Stop refreshing career pages.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[0.98rem] leading-[1.7] text-lp-muted">
            Set your preferences once. GettingShortlisted.com watches from there — and only writes when it&apos;s worth reading.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-2.5">
            <PrimaryCta>Create your free account</PrimaryCta>
            <SecondaryCta>Log in</SecondaryCta>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-lp-line">
        <div className="container-wide flex flex-col items-center justify-between gap-4 py-9 sm:flex-row">
          <span className="flex items-center gap-2 text-[0.9rem] font-semibold text-lp-text">
            <span className="grid size-5 place-items-center rounded bg-white text-[0.6rem] font-bold text-black">
              G
            </span>
            GettingShortlisted.com
          </span>
          <div className="flex items-center gap-7 text-[0.85rem] text-lp-muted">
            <a href="#how-it-works" className="transition-colors hover:text-lp-text">
              How it works
            </a>
            <Link href="/register" className="transition-colors hover:text-lp-text">
              Create account
            </Link>
            <Link href="/login" className="transition-colors hover:text-lp-text">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
