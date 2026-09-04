"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BadgeCheck, Clock } from "lucide-react";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import { useCurrentUser, invalidateCurrentUser } from "@/lib/useCurrentUser";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

/** One labelled setting on its own line, with the control on the right. */
function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 max-w-lg">
        <p className="text-[0.9rem] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[0.83rem] leading-relaxed text-ink-muted">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="eyebrow">{title}</h2>
      <div className="mt-1 divide-y divide-line">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { user, loading, error: userError } = useCurrentUser();
  const router = useRouter();

  const [notificationsPaused, setNotificationsPaused] = useState<boolean | null>(null);
  const [togglingNotifications, setTogglingNotifications] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggleNotifications(paused: boolean) {
    setTogglingNotifications(true);
    try {
      await apiFetch("/api/account/notifications", { method: "PATCH", body: JSON.stringify({ paused }) });
      setNotificationsPaused(paused);
      invalidateCurrentUser();
    } catch {
      // leave the displayed state as it was -- nothing changed server-side
    } finally {
      setTogglingNotifications(false);
    }
  }

  async function downloadExport() {
    setExportError(null);
    setExporting(true);
    try {
      const data = await apiFetch<unknown>("/api/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jobdrop-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Couldn't export your data. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    try {
      // Empty body: authentication (the Clerk session itself) is the only
      // confirmation needed now -- see account/routes.ts, which also
      // deletes the underlying Clerk account.
      await apiFetch("/api/account", { method: "DELETE" });
      invalidateCurrentUser();
      router.push("/");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete your account. Please try again.");
      setDeleting(false);
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

  if (loading || !user) {
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

  const paused = notificationsPaused ?? user.notificationsPaused;

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <header className="mb-8">
          <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-1.5 text-[0.88rem] text-ink-muted">Account, alerts and data.</p>
        </header>

        <div className="space-y-8">
          <SettingsGroup title="Account">
            <SettingRow
              title="Email address"
              description={
                <span className="flex flex-wrap items-center gap-2">
                  {user.email}
                  {user.emailVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[0.7rem] font-medium text-brand-ink">
                      <BadgeCheck className="size-3" />
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warn-tint px-2 py-0.5 text-[0.7rem] font-medium text-warn-ink">
                      <Clock className="size-3" />
                      Unverified
                    </span>
                  )}
                </span>
              }
              control={null}
            />
            <SettingRow title="Name" description={user.name} control={null} />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <SettingRow
              title="Job alert emails"
              description={
                paused
                  ? "Paused. Matching still happens, but nothing is sent until you turn this back on."
                  : "You'll get an email whenever a new role matches your preferences."
              }
              control={
                <Switch
                  checked={!paused}
                  onCheckedChange={(checked: boolean) => toggleNotifications(!checked)}
                  disabled={togglingNotifications}
                  aria-label="Job alert emails"
                />
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Data">
            <SettingRow
              title="Export your data"
              description="Everything JobDrop holds about you — profile, preferences and watchlist — as a JSON file."
              control={
                <Button variant="outline" size="sm" onClick={downloadExport} disabled={exporting}>
                  {exporting ? "Preparing…" : "Download"}
                </Button>
              }
            />
            {exportError && (
              <Alert variant="destructive" className="my-3">
                <AlertCircle />
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            )}
          </SettingsGroup>

          {/* Destructive, but not shouting: one quiet row, with the weight
              carried by the confirmation dialog rather than by a big red
              panel sitting on the page permanently. */}
          <SettingsGroup title="Security">
            <SettingRow
              title="Delete account"
              description="Permanently removes your account, preferences and watchlist. This can't be undone."
              control={
                <Button
                  variant="outline"
                  size="sm"
                  className="border-danger/30 text-danger hover:bg-danger-tint"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete account
                </Button>
              }
            />
          </SettingsGroup>
        </div>

        <Dialog
          open={deleteOpen}
          onOpenChange={(open: boolean) => {
            setDeleteOpen(open);
            if (!open) setDeleteError(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently deletes your account, preferences and company watchlist. It can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>

            {deleteError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={deleting} />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete my account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
}
