"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Briefcase, ChevronRight, Check, Plus } from "lucide-react";
import { apiFetch, ApiError, type CompanyDetail } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import CompanyLogo from "@/components/CompanyLogo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OPPORTUNITY_LABEL } from "@/lib/jobDisplay";
import { formatRecency } from "@/lib/recency";

function formatSyncTime(iso: string | null): string {
  if (!iso) return "Not synced yet";
  return `Updated ${formatRecency(iso).label}`;
}

export default function CompanyDetailPage() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const params = useParams<{ slug: string }>();

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<{ company: CompanyDetail }>(`/api/companies/${params.slug}`)
      .then((res) => {
        if (active) setCompany(res.company);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load this company.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, params.slug]);

  async function toggleWatch() {
    if (!company || toggling) return;
    setToggling(true);
    const nextWatching = !company.watching;
    try {
      if (nextWatching) {
        await apiFetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ companySlug: company.slug }) });
      } else {
        await apiFetch(`/api/subscriptions/${company.slug}`, { method: "DELETE" });
      }
      setCompany({ ...company, watching: nextWatching });
      toast.success(nextWatching ? `Watching ${company.name}` : `Stopped watching ${company.name}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update your watchlist.");
    } finally {
      setToggling(false);
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

  if (userLoading || loading) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-64" />
          <Skeleton className="mt-8 h-40 w-full" />
        </main>
      </>
    );
  }

  if (error || !company) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Alert variant="destructive">
            <AlertDescription>{error ?? "Company not found."}</AlertDescription>
          </Alert>
          <Link href="/companies" className="mt-5 inline-block text-[0.85rem] text-brand-ink hover:underline">
            Back to companies
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <Link
          href="/companies"
          className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Companies
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <CompanyLogo name={company.name} domain={company.domain} size={44} />
            <div className="min-w-0">
              <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">{company.name}</h1>
              <p className="mt-1.5 text-[0.88rem] text-ink-muted">
                <span className="font-medium text-ink-secondary">{company.openRoles.toLocaleString()}</span> open{" "}
                {company.openRoles === 1 ? "role" : "roles"} · {formatSyncTime(company.lastSyncedAt)}
              </p>
            </div>
          </div>

          <Button variant={company.watching ? "outline" : "default"} onClick={toggleWatch} disabled={toggling}>
            {company.watching ? (
              <>
                <Check className="size-4" />
                Watching
              </>
            ) : (
              <>
                <Plus className="size-4" />
                Watch
              </>
            )}
          </Button>
        </header>

        <section className="mt-8">
          <h2 className="eyebrow">Recent roles</h2>
          <div className="mt-3">
            {company.recentJobs.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="No open roles right now"
                body={`GettingShortlisted.com is watching ${company.name}. New openings will appear here as they're posted.`}
              />
            ) : (
              <div className="space-y-px">
                {company.recentJobs.map((job) => {
                  const meta = [job.level, OPPORTUNITY_LABEL[job.opportunityType]].filter(Boolean).join(" · ");
                  return (
                    <Link key={job.id} href={`/jobs/${job.id}`} className="list-row list-row-interactive group">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[0.925rem] font-medium text-ink transition-colors group-hover:text-brand-ink">
                          {job.title}
                        </h3>
                        <p className="mt-1 truncate text-[0.8rem] text-ink-muted">
                          {job.location ?? "Location not stated"}
                          {job.workMode === "REMOTE" ? " · Remote" : ""}
                        </p>
                      </div>
                      {meta && (
                        <span className="hidden shrink-0 text-[0.78rem] text-ink-secondary sm:block">{meta}</span>
                      )}
                      <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {company.roleFamilies.length > 0 && (
          <section className="mt-8">
            <h2 className="eyebrow">What they&apos;re hiring for</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {company.roleFamilies.map((r) => (
                <span
                  key={r.roleFamily}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-[0.78rem] text-ink-secondary"
                >
                  {r.roleFamily}
                  <span className="ml-1.5 text-ink-faint">{r.count}</span>
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
