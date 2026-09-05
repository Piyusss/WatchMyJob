"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, FlaskConical, Plus, ShieldAlert } from "lucide-react";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import { useCurrentUser } from "@/lib/useCurrentUser";
import {
  createTestCompany,
  listTestCompanies,
  updateTestCompanyStatus,
  ApiError,
  apiErrorMessage,
  type TestCompanyListItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

// Only reachable at all when the signed-in account is on the server's
// ADMIN_EMAILS allowlist: AuthNav already hides the link that gets here
// for anyone else, but a direct visit still has to be told, not silently
// shown a broken/empty page. The real boundary is server-side (every
// /api/admin/* call 403s regardless); this is purely so the page reads
// honestly for the one case it can't prevent: someone typing the URL.
function NotAuthorized() {
  return (
    <>
      <AuthNav />
      <main className="container-app py-10">
        <EmptyState
          icon={ShieldAlert}
          title="Admin access required"
          body="This account isn't on the admin allowlist for GettingShortlisted.in's test-company tools."
        />
      </main>
    </>
  );
}

export default function TestCompaniesClient() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();

  const [companies, setCompanies] = useState<TestCompanyListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    listTestCompanies()
      .then((res) => setCompanies(res.companies))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load test companies."))
      .finally(() => setLoaded(true));
  }, [user]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await createTestCompany({ name: name.trim(), domain: domain.trim() || null });
      toast.success(`${name.trim()} created and selectable by users immediately`);
      setName("");
      setDomain("");
      const refreshed = await listTestCompanies();
      setCompanies(refreshed.companies);
      window.location.href = `/admin/test-companies/${res.company.slug}`;
    } catch (err) {
      const message = apiErrorMessage(err, "Couldn't create this company. Please try again.", {
        name: "Company name",
        domain: "Website domain",
        slug: "Slug",
      });
      setCreateError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(company: TestCompanyListItem) {
    setPendingSlug(company.slug);
    const next = company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await updateTestCompanyStatus(company.slug, next);
      setCompanies((prev) => prev.map((c) => (c.slug === company.slug ? { ...c, status: next } : c)));
      toast.success(
        next === "ACTIVE"
          ? `${company.name} is now active`
          : `${company.name} is now disabled` +
              (res.subscriptionsDeactivated > 0
                ? `; ${res.subscriptionsDeactivated} subscriber(s) unsubscribed, no longer watching it`
                : ""),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update this company. Please try again.");
    } finally {
      setPendingSlug(null);
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

  if (userLoading) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="mt-8 h-40 w-full rounded-xl" />
        </main>
      </>
    );
  }

  if (!user?.isAdmin) {
    return <NotAuthorized />;
  }

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-ink">
            <FlaskConical className="size-4.5" />
          </span>
          <div>
            <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Test companies</h1>
            <p className="mt-1.5 max-w-xl text-[0.88rem] leading-relaxed text-ink-muted">
              Admin-only. A test company runs through the exact same pipeline a real company does. Publishing a job
              here queues real notifications for anyone genuinely subscribed and matching, sent by the real worker.
              Not visible to normal users as anything other than an ordinary company they can watch.
            </p>
          </div>
        </header>

        <section className="mt-8 rounded-xl border border-line bg-surface p-5">
          <h2 className="eyebrow">Create a test company</h2>
          <form onSubmit={onCreate} className="mt-3 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Company name</Label>
              <Input id="name" required placeholder="TestCorp" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="domain">Website domain (optional)</Label>
              <Input
                id="domain"
                placeholder="testcorp.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={creating || !name.trim()} className="gap-1.5">
              <Plus className="size-3.5" />
              {creating ? "Creating…" : "Create"}
            </Button>
          </form>
          {createError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
        </section>

        <section className="mt-8">
          <h2 className="eyebrow">Existing test companies</h2>
          {loadError && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle />
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}
          {!loaded ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : companies.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon={FlaskConical}
                title="No test companies yet"
                body="Create one above, then add and publish a job from its page to exercise the real notification pipeline."
              />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[560px] text-left text-[0.85rem]">
                <thead className="border-b border-line text-[0.72rem] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Company</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Jobs</th>
                    <th className="px-4 py-2.5 font-medium">Open</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {companies.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        <Link href={`/admin/test-companies/${c.slug}`} className="font-medium text-ink hover:text-brand-ink">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={c.status === "ACTIVE" ? "default" : "outline"}>{c.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{c.totalTestJobs}</td>
                      <td className="px-4 py-3 text-ink-secondary">{c.openJobs}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/test-companies/${c.slug}`}>
                            <Button size="sm" variant="outline">
                              Open
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pendingSlug === c.slug}
                            onClick={() => toggleStatus(c)}
                          >
                            {c.status === "ACTIVE" ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
