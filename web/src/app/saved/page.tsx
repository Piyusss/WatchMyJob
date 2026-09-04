"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check } from "lucide-react";
import { apiFetch, ApiError, buildJobsQueryString, type JobListing, type UserJobState } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import JobCard from "@/components/JobCard";
import EmptyState from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Saved and Applied share this screen rather than getting a page each: they
// are two views of the same underlying list (jobs you've marked), and the
// only thing that changes between them is one query parameter.
const TABS: { value: Extract<UserJobState, "SAVED" | "APPLIED">; label: string }[] = [
  { value: "SAVED", label: "Saved" },
  { value: "APPLIED", label: "Applied" },
];

export default function SavedPage() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const [tab, setTab] = useState<"SAVED" | "APPLIED">("SAVED");

  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<{ jobs: JobListing[] }>(`/api/jobs${buildJobsQueryString({ state: tab, limit: 100 })}`)
      .then((res) => {
        if (active) setJobs(res.jobs);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load these jobs. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, tab]);

  if (userError) {
    return (
      <>
        <AuthNav />
        <AccountLoadError message={userError} />
      </>
    );
  }

  if (userLoading || !user) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-8 h-40 w-full" />
        </main>
      </>
    );
  }

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <header className="mb-6">
          <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Your jobs</h1>
          <p className="mt-1.5 text-[0.88rem] text-ink-muted">
            Roles you&apos;ve saved or applied to. These stay here regardless of your preferences or watchlist.
          </p>
        </header>

        <Tabs value={tab} onValueChange={(v: string) => setTab(v as "SAVED" | "APPLIED")}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="mt-6">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="space-y-px">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={tab === "SAVED" ? Bookmark : Check}
              title={tab === "SAVED" ? "Nothing saved yet" : "Nothing marked applied yet"}
              body={
                tab === "SAVED"
                  ? "Save a role from your feed and it'll wait for you here."
                  : "Mark a role as applied and you'll be able to track it here."
              }
            />
          ) : (
            <div className="space-y-px">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStateChange={(state) => {
                    // Anything that isn't this tab's state drops the row from
                    // the list we're looking at.
                    setJobs((prev) =>
                      state === tab ? prev.map((j) => (j.id === job.id ? { ...j, userState: state } : j)) : prev.filter((j) => j.id !== job.id),
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
