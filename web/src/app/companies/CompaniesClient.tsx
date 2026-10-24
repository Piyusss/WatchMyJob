"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Search, Building2 } from "lucide-react";
import { toast } from "sonner";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import CompanyLogo from "@/components/CompanyLogo";
import Pagination from "@/components/Pagination";
import WatchButton from "@/components/WatchButton";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { apiFetch, type Company, type Subscription } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Seven rows of the two-column grid, so a page never ends half empty.
const PAGE_SIZE = 14;

export default function CompaniesClient() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";

  const [companies, setCompanies] = useState<Company[]>([]);
  const [watchedSlugs, setWatchedSlugs] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const listTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiFetch<{ companies: Company[] }>("/api/companies"),
      apiFetch<{ subscriptions: Subscription[] }>("/api/subscriptions"),
    ])
      .then(([companiesRes, subsRes]) => {
        setCompanies(companiesRes.companies);
        setWatchedSlugs(new Set(subsRes.subscriptions.filter((s) => s.active).map((s) => s.company.slug)));
      })
      .finally(() => setLoaded(true));
  }, [user]);

  async function toggleWatch(slug: string, currentlyWatching: boolean) {
    setError(null);
    setPending((prev) => new Set(prev).add(slug));
    const name = companies.find((c) => c.slug === slug)?.name ?? "Company";
    try {
      if (currentlyWatching) {
        await apiFetch(`/api/subscriptions/${slug}`, { method: "DELETE" });
        setWatchedSlugs((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
        toast.success(`${name} removed from your watchlist`);
      } else {
        await apiFetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ companySlug: slug }) });
        setWatchedSlugs((prev) => new Set(prev).add(slug));
        toast.success(`Now watching ${name}`);
      }
    } catch {
      setError("Something went wrong updating your watchlist. Please try again.");
      toast.error("Something went wrong updating your watchlist. Please try again.");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(q));
  }, [companies, query]);

  if (userError) {
    return (
      <>
        <AuthNav />
        <AccountLoadError message={userError} />
      </>
    );
  }

  if (userLoading || !loaded) {
    return (
      <>
        <AuthNav />
        <main className="container-wide py-10">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-3 h-4 w-80" />
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[5.5rem] w-full rounded-2xl" />
            ))}
          </div>
        </main>
      </>
    );
  }

  const watchedCount = watchedSlugs.size;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // A search can leave fewer pages than the number showing.
  const currentPage = Math.min(page, pageCount);
  const onPage = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Back up to the start of the list, or the new page would begin out of view.
  function goToPage(next: number) {
    setPage(next);
    listTop.current?.scrollIntoView({ block: "start" });
  }

  return (
    <>
      <AuthNav />
      <main className="container-wide py-9 sm:py-11">
        {isOnboarding ? (
          <header>
            {/* The final step of the six-step onboarding that starts in the
                preferences wizard: see TOTAL_ONBOARDING_STEPS there. */}
            <p className="eyebrow">Step 6 of 6</p>
            <h1 className="mt-2.5 text-[1.6rem] font-semibold tracking-tight text-ink">
              Which companies should WatchmyJob watch?
            </h1>
            <p className="mt-2 max-w-xl text-[0.9rem] leading-relaxed text-ink-muted">
              Watching starts monitoring from right now. Roles already open won&apos;t email you, only ones that
              appear from here on. Add as many as you like; you can change this anytime.
            </p>
          </header>
        ) : (
          <header>
            <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Companies</h1>
            <p className="mt-1.5 max-w-xl text-[0.88rem] leading-relaxed text-ink-muted">
              {watchedCount > 0
                ? `You're watching ${watchedCount} of ${companies.length}. Watching a company starts monitoring it from that moment. Its existing roles never trigger an email.`
                : "Choose the companies you want monitored. Their existing roles never trigger an email, only ones that appear after you start watching."}
            </p>
          </header>
        )}

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {companies.length > 6 && (
          <div className="relative mt-7 w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              className="h-8 bg-surface pl-8"
              type="search"
              placeholder="Find a company…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              aria-label="Find a company"
            />
          </div>
        )}

        {companies.length === 0 ? (
          <div className="mt-7">
            <EmptyState
              icon={Building2}
              title="No companies available yet"
              body="WatchmyJob isn't monitoring any company boards right now. Check back shortly."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-7">
            <EmptyState icon={Search} title="No companies match" body={`Nothing matched “${query.trim()}”.`} />
          </div>
        ) : (
          <>
            <div ref={listTop} className="mt-6 grid scroll-mt-24 gap-5 sm:grid-cols-2">
              {onPage.map((c) => {
                const watching = watchedSlugs.has(c.slug);
                const isPending = pending.has(c.slug);
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-4 rounded-2xl border bg-surface px-6 py-5 transition-all duration-150",
                      watching ? "border-line-strong bg-ink/[0.025]" : "border-line hover:border-line-strong hover:shadow-sm",
                    )}
                  >
                    <CompanyLogo name={c.name} domain={c.domain} size={48} />

                    {/* Only the name block navigates: the Watch button is the
                        primary action on this screen and must stay a plain
                        sibling, not a control nested inside a link. */}
                    <Link href={`/companies/${c.slug}`} className="min-w-0 flex-1">
                      <div className="truncate text-[1.02rem] font-medium text-ink transition-colors hover:text-brand-ink">
                        {c.name}
                      </div>
                      <div className="mt-1 text-[0.82rem] text-ink-muted">
                        {c.openRoles.toLocaleString()} open {c.openRoles === 1 ? "role" : "roles"}
                        {watching && <span className="text-ink-secondary"> · Watching</span>}
                      </div>
                    </Link>

                    <WatchButton
                      name={c.name}
                      watching={watching}
                      pending={isPending}
                      onClick={() => toggleWatch(c.slug, watching)}
                    />
                  </div>
                );
              })}
            </div>
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={visible.length}
              onChange={goToPage}
            />
          </>
        )}

        {isOnboarding && (
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <Link href={watchedCount > 0 ? "/dashboard?welcome=1" : "/dashboard"}>
              <Button size="lg">{watchedCount > 0 ? "Finish setup" : "Skip for now"}</Button>
            </Link>
            <span className="text-[0.82rem] text-ink-muted">
              {watchedCount > 0
                ? `We'll email you when a matching role opens at ${watchedCount === 1 ? "this company" : `these ${watchedCount} companies`}.`
                : "You can add companies at any time."}
            </span>
          </div>
        )}
      </main>
    </>
  );
}
