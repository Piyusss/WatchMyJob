"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { AlertTriangle, Search, AlertCircle, Briefcase, Building2, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import {
  apiFetch,
  ApiError,
  buildJobsQueryString,
  type JobListing,
  type JobsSort,
  type Subscription,
  type WorkMode,
  type OpportunityType,
} from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import JobCard from "@/components/JobCard";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ANY = "ANY";

const WORK_MODE_OPTIONS: { value: WorkMode; label: string }[] = [
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ON_SITE", label: "On-site" },
];

const OPPORTUNITY_TYPE_OPTIONS: { value: OpportunityType; label: string }[] = [
  { value: "FULL_TIME", label: "Full-time" },
  { value: "INTERNSHIP", label: "Internship" },
  { value: "CONTRACT", label: "Contract" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "OTHER", label: "Other" },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function DashboardPage() {
  const { user, loading, error: userError } = useCurrentUser();
  const { openUserProfile } = useClerk();

  const [watchedCompanies, setWatchedCompanies] = useState<{ slug: string; name: string }[]>([]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 350);
  const [company, setCompany] = useState(ANY);
  const [workMode, setWorkMode] = useState(ANY);
  const [opportunityType, setOpportunityType] = useState(ANY);
  const [sort, setSort] = useState<JobsSort>("newest");

  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [filtered, setFiltered] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  // Read straight from location rather than useSearchParams: this is a
  // client-only, dismissible flag, and useSearchParams would force this
  // whole page behind a Suspense boundary for no benefit.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome") === "1") {
      setShowWelcome(true);
      window.history.replaceState(null, "", "/dashboard");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ subscriptions: Subscription[] }>("/api/subscriptions")
      .then((res) =>
        setWatchedCompanies(
          res.subscriptions.filter((s) => s.active).map((s) => ({ slug: s.company.slug, name: s.company.name })),
        ),
      )
      .catch(() => {});
  }, [user]);

  const queryString = useMemo(
    () =>
      buildJobsQueryString({
        limit: 20,
        sort,
        q: debouncedSearch.trim() || undefined,
        companies: company !== ANY ? company : undefined,
        workMode: workMode !== ANY ? (workMode as WorkMode) : undefined,
        opportunityType: opportunityType !== ANY ? (opportunityType as OpportunityType) : undefined,
      }),
    [sort, debouncedSearch, company, workMode, opportunityType],
  );

  async function loadFirstPage() {
    if (!user) return;
    setLoadingJobs(true);
    setJobsError(null);
    try {
      const res = await apiFetch<{
        jobs: JobListing[];
        nextCursor: string | null;
        total: number;
        unfilteredTotal: number;
        filtered: boolean;
      }>(`/api/jobs${queryString}`);
      setJobs(res.jobs);
      setNextCursor(res.nextCursor);
      setTotal(res.total);
      setUnfilteredTotal(res.unfilteredTotal);
      setFiltered(res.filtered);
    } catch (err) {
      setJobsError(err instanceof ApiError ? err.message : "Couldn't load your jobs. Please try again.");
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, queryString]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const sep = queryString ? "&" : "?";
      const res = await apiFetch<{ jobs: JobListing[]; nextCursor: string | null }>(
        `/api/jobs${queryString}${sep}cursor=${nextCursor}`,
      );
      setJobs((prev) => [...prev, ...res.jobs]);
      setNextCursor(res.nextCursor);
    } catch {
      // a failed "load more" leaves the existing page intact: the user
      // can just click again, no need to disturb what's already shown
    } finally {
      setLoadingMore(false);
    }
  }

  if (userError) {
    return (
      <>
        <AuthNav />
        <AccountLoadError message={userError} />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-3 h-4 w-72" />
          <div className="mt-8 space-y-px">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </main>
      </>
    );
  }

  if (!user) return null;

  const preExisting = jobs.filter((j) => j.discoveredInInitialSync).length;
  const hasActiveFilters = company !== ANY || workMode !== ANY || opportunityType !== ANY || search.trim() !== "";

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        {/* Header: the summary is a single typographic line rather than a row
            of stat cards: it's context, not the point of the screen, and
            cards here would push the jobs themselves below the fold. */}
        <header>
          <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">
            {filtered ? "Jobs that match you" : "Open roles"}
          </h1>
          <p className="mt-1.5 text-[0.88rem] leading-relaxed text-ink-muted">
            {watchedCompanies.length > 0 ? (
              <>
                <span className="font-medium text-ink-secondary">{total.toLocaleString()}</span>
                {filtered ? " matching" : " open"} of {unfilteredTotal.toLocaleString()} at{" "}
                <Link href="/companies" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                  {watchedCompanies.length} {watchedCompanies.length === 1 ? "company" : "companies"} you watch
                </Link>
                {filtered ? (
                  <>
                    , filtered by your{" "}
                    <Link href="/preferences" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                      preferences
                    </Link>
                  </>
                ) : null}
                .
              </>
            ) : (
              "Pick some companies to watch and WatchmyJob.co will start monitoring them for you."
            )}
          </p>
        </header>

        {showWelcome && (
          <Alert className="mt-6 border-brand/25 bg-gradient-to-br from-brand-tint to-surface">
            <CheckCircle2 className="text-brand" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-ink-secondary">
                <span className="font-medium text-ink">You&apos;re all set.</span> We&apos;ll email you when a matching
                role opens at{" "}
                {watchedCompanies.length === 1 ? "the company" : `the ${watchedCompanies.length} companies`} you watch.
              </span>
              <Button size="sm" variant="ghost" className="text-ink-muted" onClick={() => setShowWelcome(false)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!user.emailVerified && (
          <Alert className="mt-6 border-warn-line bg-warn-tint text-warn-ink">
            <AlertTriangle className="text-warn-ink" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-warn-ink">
              <span>Verify your email to start receiving job alerts.</span>
              <Button
                size="sm"
                variant="outline"
                className="border-warn-ink/30 bg-transparent text-warn-ink hover:bg-warn-ink/10"
                onClick={() => openUserProfile()}
              >
                Verify email
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!user.hasPreferences && (
          <Alert className="mt-3 border-warn-line bg-warn-tint text-warn-ink">
            <AlertTriangle className="text-warn-ink" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-warn-ink">
              <span>You haven&apos;t set your preferences yet. No alerts will be sent until you do.</span>
              <Link href="/preferences?onboarding=1">
                {/* The one place an *-ink token is a FILL rather than text.
                    warn-ink is a dark gold in light mode and a light one in
                    dark, so white text works in exactly one of the two: the
                    dark theme flips the label to the deep tint instead. */}
                <Button size="sm" className="bg-warn-ink text-white hover:bg-warn-ink/90 dark:text-warn-tint">
                  Set preferences
                </Button>
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              className="h-8 bg-surface pl-8"
              type="search"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search open roles"
            />
          </div>

          <Select value={company} onValueChange={(v) => setCompany(v ?? ANY)}>
            <SelectTrigger className="bg-surface" aria-label="Filter by company">
              <SelectValue placeholder="Company">
                {(v: string) => (v === ANY ? "All companies" : watchedCompanies.find((c) => c.slug === v)?.name ?? v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All companies</SelectItem>
              {watchedCompanies.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={workMode} onValueChange={(v) => setWorkMode(v ?? ANY)}>
            <SelectTrigger className="bg-surface" aria-label="Filter by work mode">
              <SelectValue placeholder="Work mode">
                {(v: string) =>
                  v === ANY ? "Any work mode" : WORK_MODE_OPTIONS.find((o) => o.value === v)?.label ?? v
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any work mode</SelectItem>
              {WORK_MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={opportunityType} onValueChange={(v) => setOpportunityType(v ?? ANY)}>
            <SelectTrigger className="bg-surface" aria-label="Filter by opportunity type">
              <SelectValue placeholder="Type">
                {(v: string) =>
                  v === ANY ? "Any type" : OPPORTUNITY_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {OPPORTUNITY_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort((v as JobsSort) ?? "newest")}>
            <SelectTrigger className="bg-surface" aria-label="Sort roles">
              <SelectValue placeholder="Sort">
                {(v: string) => (v === "updated" ? "Recently updated" : "Newest")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="updated">Recently updated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {preExisting > 0 && !loadingJobs && !jobsError && (
          <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
            {preExisting} of these were already open when you started watching: visible here, but never emailed.
          </p>
        )}

        <div className="mt-4">
          {jobsError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{jobsError}</span>
                <Button size="sm" variant="outline" onClick={loadFirstPage}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          ) : loadingJobs ? (
            <div className="list-surface">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="list-row">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            hasActiveFilters ? (
              <EmptyState
                icon={Search}
                title="No roles match these filters"
                body="Try clearing a filter or widening your search."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setCompany(ANY);
                      setWorkMode(ANY);
                      setOpportunityType(ANY);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : watchedCompanies.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="You're not watching any companies yet"
                body="Choose the companies you care about and WatchmyJob.co will email you when a matching role opens."
                action={
                  <Link href="/companies">
                    <Button>Pick companies</Button>
                  </Link>
                }
              />
            ) : filtered ? (
              <EmptyState
                icon={SlidersHorizontal}
                title="Nothing open matches your preferences"
                body="Everything at your watched companies was checked. None of it fits right now. We'll email you the moment something does."
                action={
                  <Link href="/preferences">
                    <Button variant="outline">Adjust preferences</Button>
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={Briefcase}
                title="No open roles right now"
                body="Nothing is currently open at the companies you watch. We'll keep checking."
              />
            )
          ) : (
            <>
              <div className="list-surface">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onStateChange={(state) => {
                      // A dismissed job is gone from this feed by definition,
                      // so drop it locally rather than leaving a row the next
                      // refetch would remove anyway. Other states just update
                      // in place so the button reflects the new stance.
                      setJobs((prev) =>
                        state === "DISMISSED"
                          ? prev.filter((j) => j.id !== job.id)
                          : prev.map((j) => (j.id === job.id ? { ...j, userState: state } : j)),
                      );
                      if (state === "DISMISSED") setTotal((t) => Math.max(0, t - 1));
                    }}
                  />
                ))}
              </div>

              <div className="mt-5 flex flex-col items-center gap-2">
                {nextCursor && (
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                )}
                <p className="text-[0.75rem] text-ink-faint">
                  Showing {jobs.length} of {total.toLocaleString()}
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
