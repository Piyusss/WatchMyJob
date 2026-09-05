"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { apiFetch, ApiError, type NotificationHistoryItem, type NotificationStatus } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// Only states a user can act on or be reassured by are given words here.
// PROVIDER_ACCEPTED/DELIVERED both read as "Sent": the distinction between
// "the provider took it" and "the provider confirmed delivery" is an
// operational detail, and most providers never report the latter at all, so
// surfacing it would leave most rows looking permanently unfinished.
const STATUS_LABEL: Record<NotificationStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  SENDING: { label: "Sending", tone: "muted" },
  PROVIDER_ACCEPTED: { label: "Sent", tone: "ok" },
  DELIVERED: { label: "Delivered", tone: "ok" },
  BOUNCED: { label: "Bounced", tone: "bad" },
  COMPLAINED: { label: "Marked as spam", tone: "bad" },
  FAILED: { label: "Retrying", tone: "warn" },
  SKIPPED: { label: "Not sent", tone: "muted" },
  DEAD_LETTER: { label: "Failed", tone: "bad" },
};

const TONE_CLASS: Record<"ok" | "warn" | "bad" | "muted", string> = {
  ok: "bg-brand-tint text-brand-ink",
  warn: "bg-warn-tint text-warn-ink",
  bad: "bg-danger-tint text-danger-ink",
  muted: "bg-tint-strong text-ink-muted",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();

  const [items, setItems] = useState<NotificationHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch<{ notifications: NotificationHistoryItem[]; nextCursor: string | null; total: number }>(
      "/api/notifications",
    )
      .then((res) => {
        if (!active) return;
        setItems(res.notifications);
        setNextCursor(res.nextCursor);
        setTotal(res.total);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load your notifications.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<{ notifications: NotificationHistoryItem[]; nextCursor: string | null }>(
        `/api/notifications?cursor=${nextCursor}`,
      );
      setItems((prev) => [...prev, ...res.notifications]);
      setNextCursor(res.nextCursor);
    } catch {
      // leave what's already loaded alone: the user can click again
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

  if (userLoading || !user) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-7 w-48" />
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
          <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Notifications</h1>
          <p className="mt-1.5 text-[0.88rem] text-ink-muted">
            {total > 0
              ? `A record of the ${total.toLocaleString()} alert${total === 1 ? "" : "s"} GettingShortlisted.in has sent you.`
              : "A record of the job alerts GettingShortlisted.in has sent you."}
          </p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-px">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No alerts yet"
            body="When a new role matches your preferences, the email we send will be listed here."
          />
        ) : (
          <>
            <div className="space-y-px">
              {items.map((n) => {
                const status = STATUS_LABEL[n.status];
                return (
                  <Link key={n.id} href={`/jobs/${n.job.id}`} className="list-row list-row-interactive group">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[0.66rem] font-semibold uppercase tracking-wide",
                            TONE_CLASS[status.tone],
                          )}
                        >
                          {status.label}
                        </span>
                        <h3 className="truncate text-[0.925rem] font-medium text-ink transition-colors group-hover:text-brand-ink">
                          {n.job.title}
                        </h3>
                      </div>
                      <p className="mt-1 truncate text-[0.8rem] text-ink-muted">
                        <span className="text-ink-secondary">{n.job.company.name}</span>
                        {n.job.location ? ` · ${n.job.location}` : ""}
                        {n.job.status === "CLOSED" ? " · Role closed" : ""}
                      </p>
                    </div>

                    <span className="hidden shrink-0 text-[0.78rem] text-ink-faint sm:block">
                      {formatWhen(n.sentAt ?? n.createdAt)}
                    </span>

                    <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted" />
                  </Link>
                );
              })}
            </div>

            {nextCursor && (
              <div className="mt-6 text-center">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
