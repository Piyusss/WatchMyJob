"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Briefcase, CheckCircle2, ExternalLink, Rocket, ShieldAlert } from "lucide-react";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import EmptyState from "@/components/EmptyState";
import RoleFamilySelect from "@/components/RoleFamilySelect";
import LevelSelect from "@/components/LevelSelect";
import LocationPicker from "@/components/LocationPicker";
import { useCurrentUser } from "@/lib/useCurrentUser";
import {
  ApiError,
  createTestJob,
  getTestCompany,
  publishTestJob,
  updateTestCompanyStatus,
  updateTestJob,
  type Level,
  type OpportunityType,
  type PreferenceLocation,
  type PublishTestJobResult,
  type TestCompanyDetail,
  type TestJob,
  type TestJobInput,
  type WorkMode,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
const NONE = "__none__";

function emptyForm(): TestJobInput {
  return {
    title: "",
    roleFamily: "",
    level: null,
    locations: [],
    workMode: null,
    opportunityType: "FULL_TIME",
    requiredExperienceMin: null,
    requiredExperienceMax: null,
    description: null,
    applicationUrl: "",
  };
}

function toFormInput(job: TestJob): TestJobInput {
  return {
    title: job.title,
    roleFamily: job.roleFamily,
    level: job.level,
    locations: job.locations,
    workMode: job.workMode,
    opportunityType: job.opportunityType,
    requiredExperienceMin: job.requiredExperienceMin,
    requiredExperienceMax: job.requiredExperienceMax,
    description: job.description,
    applicationUrl: job.applicationUrl,
  };
}

function NotAuthorized() {
  return (
    <>
      <AuthNav />
      <main className="container-app py-10">
        <EmptyState
          icon={ShieldAlert}
          title="Admin access required"
          body="This account isn't on the admin allowlist for GettingShortlisted.com's test-company tools."
        />
      </main>
    </>
  );
}

export default function TestCompanyDetailPage() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  const [company, setCompany] = useState<TestCompanyDetail | null>(null);
  const [jobs, setJobs] = useState<TestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [form, setForm] = useState<TestJobInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [lastPublish, setLastPublish] = useState<{ jobId: string; result: PublishTestJobResult } | null>(null);

  async function reload() {
    const res = await getTestCompany(params.slug);
    setCompany(res.company);
    setJobs(res.jobs);
  }

  useEffect(() => {
    if (!user?.isAdmin) return;
    setLoading(true);
    setLoadError(null);
    reload()
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load this test company."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, params.slug]);

  async function toggleStatus() {
    if (!company) return;
    setTogglingStatus(true);
    const next = company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await updateTestCompanyStatus(company.slug, next);
      setCompany({ ...company, status: res.company.status });
      toast.success(
        next === "ACTIVE"
          ? `${company.name} is now active`
          : `${company.name} is now disabled` +
              (res.subscriptionsDeactivated > 0
                ? ` — ${res.subscriptionsDeactivated} subscriber(s) unsubscribed, no longer watching it`
                : ""),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update this company.");
    } finally {
      setTogglingStatus(false);
    }
  }

  function startEdit(job: TestJob) {
    setEditingJobId(job.id);
    setForm(toFormInput(job));
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingJobId(null);
    setForm(emptyForm());
    setFormError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (editingJobId) {
        await updateTestJob(editingJobId, form);
        toast.success("Job updated");
      } else {
        await createTestJob(params.slug, form);
        toast.success("Draft job created — publish it to run the real pipeline");
      }
      cancelEdit();
      await reload();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't save this job. Please try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function onPublish(jobId: string) {
    setPublishingId(jobId);
    try {
      const res = await publishTestJob(jobId);
      setLastPublish({ jobId, result: res });
      toast.success(
        res.result.queued > 0
          ? `Published — ${res.result.queued} notification(s) queued`
          : "Published — no matching subscribers right now",
      );
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't publish this job. Please try again.");
    } finally {
      setPublishingId(null);
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
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-64" />
          <Skeleton className="mt-8 h-40 w-full" />
        </main>
      </>
    );
  }

  if (!user?.isAdmin) {
    return <NotAuthorized />;
  }

  if (loading) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-64" />
          <Skeleton className="mt-8 h-64 w-full" />
        </main>
      </>
    );
  }

  if (loadError || !company) {
    return (
      <>
        <AuthNav />
        <main className="container-app py-10">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{loadError ?? "Test company not found."}</AlertDescription>
          </Alert>
          <Link href="/admin/test-companies" className="mt-5 inline-block text-[0.85rem] text-brand-ink hover:underline">
            Back to test companies
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <button
          onClick={() => router.push("/admin/test-companies")}
          className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Test companies
        </button>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">{company.name}</h1>
              <Badge variant={company.status === "ACTIVE" ? "default" : "outline"}>{company.status}</Badge>
            </div>
            <p className="mt-1.5 text-[0.85rem] text-ink-muted">
              {company.selectable ? (
                <>
                  <CheckCircle2 className="mr-1 inline size-3.5 text-brand" />
                  Selectable — a real user can watch <span className="font-medium text-ink-secondary">{company.name}</span> right now
                </>
              ) : (
                "Not yet selectable"
              )}
              {" · "}
              <Link href={`/companies/${company.slug}`} className="text-brand-ink hover:underline">
                View as a user
              </Link>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={toggleStatus} disabled={togglingStatus}>
            {company.status === "ACTIVE" ? "Disable" : "Enable"}
          </Button>
        </header>

        <section className="mt-8 rounded-xl border border-line bg-surface p-5">
          <h2 className="eyebrow">{editingJobId ? "Edit job" : "Create a job"}</h2>
          <p className="mt-2 max-w-2xl text-[0.85rem] leading-relaxed text-ink-muted">
            {editingJobId
              ? "Saving updates the draft. Publish (or re-publish) to push the change through the real pipeline."
              : "Creating a draft doesn't notify anyone by itself — nothing happens until you publish it below."}
          </p>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="title">Job title</Label>
                <Input
                  id="title"
                  required
                  placeholder="Staff Software Engineer"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="roleFamily">Role</Label>
                <RoleFamilySelect value={form.roleFamily || null} onChange={(v) => setForm({ ...form, roleFamily: v ?? "" })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="level">Level</Label>
                <LevelSelect value={form.level} onChange={(v: Level | null) => setForm({ ...form, level: v })} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Locations</Label>
              <LocationPicker value={form.locations} onChange={(locations: PreferenceLocation[]) => setForm({ ...form, locations })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workMode">Work mode</Label>
                <Select
                  value={form.workMode ?? NONE}
                  onValueChange={(v) => setForm({ ...form, workMode: v === NONE ? null : (v as WorkMode) })}
                >
                  <SelectTrigger className="w-full bg-surface" aria-label="Work mode">
                    <SelectValue placeholder="Not stated" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not stated</SelectItem>
                    {WORK_MODE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="opportunityType">Employment type</Label>
                <Select
                  value={form.opportunityType}
                  onValueChange={(v) => setForm({ ...form, opportunityType: v as OpportunityType })}
                >
                  <SelectTrigger className="w-full bg-surface" aria-label="Employment type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPPORTUNITY_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="applicationUrl">Application URL</Label>
                <Input
                  id="applicationUrl"
                  required
                  type="url"
                  placeholder="https://example.com/careers/123"
                  value={form.applicationUrl}
                  onChange={(e) => setForm({ ...form, applicationUrl: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reqMin">Required experience — min years</Label>
                <Input
                  id="reqMin"
                  type="number"
                  min={0}
                  max={60}
                  placeholder="Not stated"
                  value={form.requiredExperienceMin ?? ""}
                  onChange={(e) => setForm({ ...form, requiredExperienceMin: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reqMax">Required experience — max years</Label>
                <Input
                  id="reqMax"
                  type="number"
                  min={0}
                  max={60}
                  placeholder="Open-ended"
                  value={form.requiredExperienceMax ?? ""}
                  onChange={(e) => setForm({ ...form, requiredExperienceMax: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <textarea
                id="description"
                rows={4}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-[0.88rem] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Whatever you'd like the job detail page to show."
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editingJobId ? "Save changes" : "Create draft"}
              </Button>
              {editingJobId && (
                <Button type="button" variant="ghost" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="eyebrow">Jobs</h2>
          <div className="mt-3">
            {jobs.length === 0 ? (
              <EmptyState icon={Briefcase} title="No jobs yet" body="Create one above to get started." />
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => {
                  const publishResult = lastPublish?.jobId === job.id ? lastPublish.result : null;
                  return (
                    <div key={job.id} className="rounded-xl border border-line bg-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[0.95rem] font-medium text-ink">{job.title}</h3>
                            <Badge variant={job.published ? "default" : "outline"}>{job.published ? "Published" : "Draft"}</Badge>
                          </div>
                          <p className="mt-1 text-[0.8rem] text-ink-muted">
                            {[job.roleFamily, job.level, job.locations.map((l) => [l.cityName, l.stateName, l.countryName].filter(Boolean).join(", ")).join("; ") || null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {job.job && (
                            <Link
                              href={`/jobs/${job.job.id}`}
                              className="mt-1.5 inline-flex items-center gap-1 text-[0.78rem] text-brand-ink hover:underline"
                            >
                              View real job page <ExternalLink className="size-3" />
                            </Link>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEdit(job)}>
                            Edit
                          </Button>
                          <Button size="sm" onClick={() => onPublish(job.id)} disabled={publishingId === job.id} className="gap-1.5">
                            <Rocket className="size-3.5" />
                            {publishingId === job.id ? "Publishing…" : job.published ? "Re-publish" : "Publish"}
                          </Button>
                        </div>
                      </div>

                      {publishResult && (
                        <div className="mt-3 rounded-lg border border-brand/25 bg-brand-tint/40 px-3.5 py-2.5 text-[0.8rem] text-brand-ink">
                          <p className="font-medium">{publishResult.result.summary}</p>
                          {Object.keys(publishResult.notificationsByStatus).length > 0 && (
                            <p className="mt-1 text-ink-secondary">
                              Notifications:{" "}
                              {Object.entries(publishResult.notificationsByStatus)
                                .map(([status, count]) => `${count} ${status}`)
                                .join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
