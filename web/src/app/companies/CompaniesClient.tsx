"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Check, Plus, Search, Building2 } from "lucide-react";
import { toast } from "sonner";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { apiFetch, type Company, type Subscription } from "@/lib/api";
import { avatarColors, avatarInitial } from "@/lib/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
        <main className="container-app py-10">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-3 h-4 w-80" />
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[4.5rem] w-full rounded-xl" />
            ))}
          </div>
        </main>
      </>
    );
  }

  const watchedCount = watchedSlugs.size;

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        {isOnboarding ? (
          <header>
            {/* The final step of the six-step onboarding that starts in the
                preferences wizard -- see TOTAL_ONBOARDING_STEPS there. */}
            <p className="eyebrow">Step 6 of 6</p>
            <h1 className="mt-2.5 text-[1.6rem] font-semibold tracking-tight text-ink">
              Which companies should GettingShortlisted.com watch?
            </h1>
            <p className="mt-2 max-w-xl text-[0.9rem] leading-relaxed text-ink-muted">
              Watching starts monitoring from right now — roles already open won&apos;t email you, only ones that
              appear from here on. Add as many as you like; you can change this anytime.
            </p>
          </header>
        ) : (
          <header>
            <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Companies</h1>
            <p className="mt-1.5 max-w-xl text-[0.88rem] leading-relaxed text-ink-muted">
              {watchedCount > 0
                ? `You're watching ${watchedCount} of ${companies.length}. Watching a company starts monitoring it from that moment — its existing roles never trigger an email.`
                : "Choose the companies you want monitored. Their existing roles never trigger an email — only ones that appear after you start watching."}
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
          <div className="relative mt-7 max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              className="h-8 bg-surface pl-8"
              type="search"
              placeholder="Find a company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find a company"
            />
          </div>
        )}

        {companies.length === 0 ? (
          <div className="mt-7">
            <EmptyState
              icon={Building2}
              title="No companies available yet"
              body="GettingShortlisted.com isn't monitoring any company boards right now. Check back shortly."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-7">
            <EmptyState icon={Search} title="No companies match" body={`Nothing matched “${query.trim()}”.`} />
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {visible.map((c) => {
              const watching = watchedSlugs.has(c.slug);
              const isPending = pending.has(c.slug);
              const colors = avatarColors(c.name);
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-3.5 rounded-xl border bg-surface px-4 py-3.5 transition-all duration-150",
                    watching ? "border-brand/35 bg-brand-tint/25" : "border-line hover:border-line-strong hover:shadow-sm",
                  )}
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg text-[0.95rem] font-bold"
                    style={{ background: colors.bg, color: colors.fg }}
                  >
                    {avatarInitial(c.name)}
                  </span>

                  {/* Only the name block navigates -- the Watch button is the
                      primary action on this screen and must stay a plain
                      sibling, not a control nested inside a link. */}
                  <Link href={`/companies/${c.slug}`} className="min-w-0 flex-1">
                    <div className="truncate text-[0.92rem] font-medium text-ink transition-colors hover:text-brand-ink">
                      {c.name}
                    </div>
                    <div className="mt-0.5 text-[0.78rem] text-ink-muted">
                      {c.openRoles.toLocaleString()} open {c.openRoles === 1 ? "role" : "roles"}
                      {watching && <span className="text-brand"> · Watching</span>}
                    </div>
                  </Link>

                  <Button
                    size="sm"
                    variant={watching ? "outline" : "default"}
                    disabled={isPending}
                    onClick={() => toggleWatch(c.slug, watching)}
                    aria-label={watching ? `Stop watching ${c.name}` : `Watch ${c.name}`}
                    className={cn("min-w-[5.5rem] gap-1", watching && "border-brand/40 text-brand-ink")}
                  >
                    {isPending ? (
                      "…"
                    ) : watching ? (
                      <>
                        <Check className="size-3.5" />
                        Watching
                      </>
                    ) : (
                      <>
                        <Plus className="size-3.5" />
                        Watch
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
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
