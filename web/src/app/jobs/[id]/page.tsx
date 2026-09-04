"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, AlertCircle } from "lucide-react";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import JobStateActions from "@/components/JobStateActions";
import WhyThisMatches from "@/components/WhyThisMatches";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { apiFetch, ApiError, type JobDetail } from "@/lib/api";
import { OPPORTUNITY_LABEL, experienceLabel } from "@/lib/jobDisplay";
import { formatRecency } from "@/lib/recency";
import { avatarColors, avatarInitial } from "@/lib/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function JobDetailPage() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    apiFetch<{ job: JobDetail }>(`/api/jobs/${params.id}`)
      .then((res) => setJob(res.job))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this job. Please try again."))
      .finally(() => setLoading(false));
  }, [user, params.id, retryCount]);

  if (userError) {
    return (
      <>
        <AuthNav />
        <AccountLoadError message={userError} />
      </>
    );
  }

  if (userLoading) return null;

  return (
    <>
      <AuthNav />
      <main className="container-app py-8 sm:py-10">
        <button
          onClick={() => router.back()}
          className="mb-7 inline-flex items-center gap-1.5 text-[0.83rem] font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-10 w-44" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => setRetryCount((n) => n + 1)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : job ? (
          <JobDetailContent job={job} />
        ) : null}
      </main>
    </>
  );
}

function JobDetailContent({ job }: { job: JobDetail }) {
  // Local copy so the buttons reflect a change immediately; the server
  // remains the source of truth on the next load of this page.
  const [userState, setUserState] = useState(job.userState);
  const expLabel = experienceLabel(job);
  const recency = formatRecency(job.firstSeenAt);
  const colors = avatarColors(job.company.name);
  const showAsNew = recency.isNew && !job.discoveredInInitialSync;

  // Meta reads as one sentence of facts rather than a row of badges --
  // location, arrangement, type, seniority and experience are all the same
  // kind of information and don't need six separate chips to say so.
  const meta = [
    job.location,
    job.workMode === "REMOTE" ? "Remote" : job.workMode === "HYBRID" ? "Hybrid" : null,
    OPPORTUNITY_LABEL[job.opportunityType],
    job.level,
    expLabel,
  ].filter(Boolean);

  return (
    <article>
      <header>
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[0.8rem] font-bold"
            style={{ background: colors.bg, color: colors.fg }}
          >
            {avatarInitial(job.company.name)}
          </span>
          <span className="text-[0.9rem] font-medium text-ink-secondary">{job.company.name}</span>
          {showAsNew && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[0.66rem] font-semibold uppercase tracking-wide text-brand-ink">
              <span className="size-1.5 rounded-full bg-brand" />
              New
            </span>
          )}
          {job.status === "CLOSED" && (
            <span className="rounded-full bg-tint px-2 py-0.5 text-[0.66rem] font-medium text-ink-muted">
              No longer open
            </span>
          )}
        </div>

        <h1 className="mt-4 text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[2.1rem]">
          {job.title}
        </h1>

        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-muted">{meta.join(" · ")}</p>

        <p className="mt-1.5 text-[0.8rem] text-ink-faint">
          {job.discoveredInInitialSync
            ? "Already open when you started watching — never emailed"
            : `First seen ${recency.label.replace(/^New(?: today)? · /, "")}`}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* A closed job keeps a de-emphasized, differently-worded link
              rather than the normal Apply CTA -- the "No longer open" badge
              above is easy to miss, and a prominent brand-colored "Apply"
              button would contradict it regardless. */}
          <a href={job.sourceUrl} target="_blank" rel="noreferrer">
            {job.status === "CLOSED" ? (
              <Button size="lg" variant="outline" className="h-10 gap-2 px-5">
                View closed posting
                <ExternalLink className="size-3.5" />
              </Button>
            ) : (
              <Button size="lg" className="h-10 gap-2 px-5 shadow-brand">
                Apply on company site
                <ExternalLink className="size-3.5" />
              </Button>
            )}
          </a>
          <JobStateActions jobId={job.id} state={userState} onChange={setUserState} />
          <span className="text-[0.78rem] text-ink-faint">
            {job.status === "CLOSED" ? "This role is no longer accepting applications" : `Opens ${job.company.name}'s own careers page`}
          </span>
        </div>
      </header>

      {job.matchExplanation?.overallMatch && (
        <div className="mt-8">
          <WhyThisMatches explanation={job.matchExplanation} />
        </div>
      )}

      {job.description ? (
        <section className="mt-10 border-t border-line pt-8">
          <h2 className="eyebrow">About this role</h2>
          {/* The source's HTML is converted to plain text server-side (see
              jobs/routes.ts -- rendering third-party markup directly would
              be an XSS risk). Its line structure survives that conversion,
              so each line becomes its own block here: that restores the
              paragraph and bullet rhythm of the original posting without
              trusting any of its markup. */}
          <div className="mt-4 max-w-[68ch] space-y-2.5">
            {job.description
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, i) => (
                <p key={i} className="text-[0.92rem] leading-[1.7] text-ink-secondary">
                  {line}
                </p>
              ))}
          </div>
        </section>
      ) : (
        <section className="mt-10 border-t border-line pt-8">
          <p className="text-[0.88rem] text-ink-muted">
            This source didn&apos;t provide a description. Open the posting on {job.company.name}&apos;s site for the
            full details.
          </p>
        </section>
      )}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <a href={job.sourceUrl} target="_blank" rel="noreferrer">
          <Button variant="outline" className="gap-2">
            Apply on company site
            <ExternalLink className="size-3.5" />
          </Button>
        </a>
        <Link href="/companies" className="text-[0.85rem] font-medium text-brand-ink underline-offset-2 hover:underline">
          Manage watched companies →
        </Link>
      </footer>
    </article>
  );
}
