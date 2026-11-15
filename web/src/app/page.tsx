import Image from "next/image";
import Link from "next/link";

// The landing page. It says what the product does, shows the one thing it
// sends you, explains how in three steps, and names who it follows. It's
// deliberately plain: white, near-black ink and one grey, with the brand
// blue only in keyboard focus rings. No bold type, no gradients, no motion:
// the restraint is the design.
//
// Everything on it is true of the product. Every company named is one the
// server follows (server/companies.json, 143 today, hence "more than 140" as the list
// changes), the job boards named are the ones it reads, matching checks the
// six preferences the "Say what you want" step
// lists, and the email preview mirrors the real alert (server/internal/
// notify/job-alert.html): its subject ("New job match: <role> at <company>",
// split between the card's top row and its title) and its details. The line
// under the title is the point of the product: you hear about the role early.
//
// A Server Component: nothing here needs the browser, so the page ships as
// plain HTML with no JavaScript of its own.

// Shown by name rather than logo: a row of brand logos brings a dozen colours
// back onto a page built on four.
const COMPANIES = ["Stripe", "Airbnb", "Databricks", "Figma", "Notion", "OpenAI", "Anthropic", "Cloudflare", "Coinbase", "Datadog"];

// The three platforms the server reads openings from (server/internal/boards),
// most-used first: 90 of the companies post on Greenhouse, 46 on Ashby, 7 on Lever.
const JOB_BOARDS = [
  { name: "Greenhouse", logo: "/logos/greenhouse.png" },
  { name: "Ashby", logo: "/logos/ashby.png" },
  { name: "Lever", logo: "/logos/lever.png" },
];

const STEPS: { title: string; body: string; boards?: typeof JOB_BOARDS }[] = [
  {
    title: "Pick companies",
    body: "Choose from more than 140 companies. We read their openings straight from the job boards they use:",
    boards: JOB_BOARDS,
  },
  { title: "Say what you want", body: "Role, level, location, work mode, job type and years of experience." },
  { title: "Get the email", body: "When a role that fits you opens, it's in your inbox within minutes." },
];

// The details the real alert lists, in its order, for one plausible job.
const EXAMPLE_DETAILS = [
  ["Level", "Senior"],
  ["Location", "Bengaluru"],
  ["Work mode", "Hybrid"],
  ["Job type", "Full-time"],
];

// The footer's links, each shown as its brand's own mark in the brand's colour:
// LinkedIn blue, YouTube red, and GitHub's black (the page's ink). The marks
// are Simple Icons' paths on a 24-unit grid; the label is what a screen reader
// reads out and what the tooltip shows.
const SOCIAL_LINKS = [
  {
    label: "Source on GitHub",
    href: "https://github.com/Piyusss/WatchMyJob",
    color: "text-ink",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/piy777sus/",
    color: "text-[#0a66c2]",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@whyn0tdp/videos",
    color: "text-[#ff0000]",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
];

/** What a "new job match" email looks like. An illustration, not a link. */
function AlertPreview() {
  return (
    <figure className="rounded-xl border border-line bg-canvas">
      <figcaption className="sr-only">An example of the email WatchmyJob sends</figcaption>
      <div className="flex justify-between border-b border-line px-5 py-3 text-[0.8125rem] text-ink-muted">
        <span>New job match</span>
        <span>4 min ago</span>
      </div>
      <div className="px-5 pb-6 pt-5">
        {/* The company's logo beside the subject, as the app's job lists show it. */}
        <div className="flex items-start gap-3.5">
          <Image src="/logos/databricks.png" alt="Databricks" width={32} height={32} className="mt-0.5 size-8 shrink-0" />
          <div>
            <p className="text-[0.9375rem] font-medium leading-snug text-ink">
              Senior Backend Engineer at Databricks
            </p>
            <p className="mt-1.5 text-[0.875rem] text-ink-muted">Be the first to apply.</p>
          </div>
        </div>
        <dl className="mt-5 divide-y divide-line border-y border-line text-[0.875rem]">
          {EXAMPLE_DETAILS.map(([label, value]) => (
            <div key={label} className="flex justify-between py-2.5">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <span aria-hidden className="mt-5 inline-flex rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-medium text-white">
          View job
        </span>
      </div>
    </figure>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <nav className="container-wide flex h-16 items-center justify-between">
        <span className="text-[0.9375rem] font-medium tracking-tight">WatchmyJob</span>
        <div className="flex items-center gap-6 text-[0.875rem]">
          <Link href="/login" className="text-ink-muted transition-colors hover:text-ink">
            Sign in
          </Link>
          <Link href="/register" className="rounded-full bg-ink px-4 py-2 text-white transition-opacity hover:opacity-85">
            Get started
          </Link>
        </div>
      </nav>

      <main>
        <header className="container-wide grid items-center gap-16 pb-24 pt-16 sm:pb-32 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-24 lg:pt-32">
          <div>
            <h1 className="max-w-[16ch] text-[2.5rem] font-normal leading-[1.08] tracking-[-0.03em] sm:text-[3.25rem] lg:text-[3.5rem]">
              Job alerts from the companies you follow.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[1.0625rem] leading-[1.65] text-ink-muted sm:text-[1.125rem]">
              WatchmyJob reads the job boards of more than 140 companies every few minutes and emails you when a role
              that fits you goes live, so you can apply early.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4 text-[0.9375rem]">
              <Link href="/register" className="rounded-full bg-ink px-5 py-2.5 text-white transition-opacity hover:opacity-85">
                Get started
              </Link>
              <a href="#how-it-works" className="text-ink transition-colors hover:text-ink-muted">
                How it works <span aria-hidden>→</span>
              </a>
            </div>
          </div>
          <AlertPreview />
        </header>

        {/* Heading on the left, the steps as a numbered list on the right:
            an editorial layout rather than three equal columns. */}
        <section id="how-it-works" className="scroll-mt-8 border-t border-line">
          <div className="container-wide grid gap-12 py-20 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-24">
            <div>
              <h2 className="text-[1.75rem] font-normal tracking-[-0.02em] sm:text-[2rem]">How it works</h2>
              <p className="mt-4 max-w-[22rem] text-[1rem] leading-[1.6] text-ink-muted">
                Three steps. No job sites to search.
              </p>
            </div>
            {/* Nudged down beside the heading, so the first step's title sits on its baseline. */}
            <ol className="divide-y divide-line lg:mt-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex items-baseline gap-6 py-7 first:pt-0 last:pb-0 sm:gap-8">
                  <span className="text-[0.875rem] tabular-nums text-ink-muted">{i + 1}</span>
                  <div>
                    <h3 className="text-[1.0625rem] font-medium">{step.title}</h3>
                    <p className="mt-2 max-w-[28rem] text-[0.9375rem] leading-[1.6] text-ink-muted">{step.body}</p>
                    {step.boards && (
                      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.875rem] text-ink-secondary">
                        {step.boards.map((board) => (
                          <li key={board.name} className="flex items-center gap-2">
                            {/* The name is beside it, so the logo itself is decorative. */}
                            <Image src={board.logo} alt="" width={18} height={18} className="size-[18px] rounded-[4px]" />
                            {board.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="container-wide py-16 sm:py-24">
            <p className="text-[0.875rem] text-ink-muted">Following more than 140 companies, including</p>
            <ul className="mt-6 flex flex-wrap gap-x-10 gap-y-4 text-[1.125rem] tracking-tight text-ink-secondary sm:text-[1.25rem]">
              {COMPANIES.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="container-wide flex flex-col gap-6 py-10 text-[0.875rem] sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-ink">WatchmyJob</p>
            <p className="mt-1 text-ink-muted">A personal project by Piyush Raj, built for learning.</p>
          </div>
          <div className="sm:text-right">
            {/* Each link is a 32px tap target around a 20px mark; the negative
                margin lines the marks themselves up with the text's edges. */}
            <ul className="-m-1.5 flex gap-2 sm:justify-end">
              {SOCIAL_LINKS.map(({ label, href, color, path }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={label}
                    title={label}
                    className={`grid size-8 place-items-center rounded-md transition-opacity hover:opacity-75 ${color}`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-5">
                      <path d={path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-ink-muted">Built with Go, DynamoDB and Next.js.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
