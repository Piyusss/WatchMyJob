"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2 } from "lucide-react";
import AuthNav from "@/components/AuthNav";
import AccountLoadError from "@/components/AccountLoadError";
import { useCurrentUser, invalidateCurrentUser } from "@/lib/useCurrentUser";
import { apiFetch, ApiError, type Preferences, type WorkMode, type OpportunityType } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const WORK_MODES: { value: WorkMode; label: string; hint: string }[] = [
  { value: "REMOTE", label: "Remote", hint: "Work from anywhere" },
  { value: "HYBRID", label: "Hybrid", hint: "Some days in office" },
  { value: "ON_SITE", label: "On-site", hint: "Fully in person" },
];

const OPPORTUNITY_TYPES: { value: OpportunityType; label: string; hint: string }[] = [
  { value: "FULL_TIME", label: "Full-time", hint: "Permanent roles" },
  { value: "INTERNSHIP", label: "Internship", hint: "Including new-grad programs" },
  { value: "CONTRACT", label: "Contract", hint: "Fixed-term engagements" },
  { value: "PART_TIME", label: "Part-time", hint: "Reduced hours" },
  { value: "OTHER", label: "Other", hint: "Anything uncategorised" },
];

const STEPS = [
  { key: "role", question: "What kind of role are you looking for?" },
  { key: "experience", question: "How much experience do you have?" },
  { key: "location", question: "Where do you want to work?" },
  { key: "workMode", question: "What work setup do you prefer?" },
  { key: "opportunity", question: "Which opportunities should we send?" },
] as const;

// The five questions here plus the company picker on /companies -- the
// whole onboarding is one six-step flow and the progress bar says so.
const TOTAL_ONBOARDING_STEPS = STEPS.length + 1;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A multi-select tile: label + one line of context, checked state on the left. */
function OptionTile({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150",
        active
          ? "border-brand/45 bg-brand-tint/50 shadow-xs"
          : "border-line bg-surface hover:border-line-strong hover:bg-tint/40",
      )}
    >
      <span
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded-full border transition-colors",
          active ? "border-brand bg-brand text-white" : "border-line-strong bg-surface",
        )}
      >
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9rem] font-medium text-ink">{label}</span>
        <span className="block text-[0.78rem] text-ink-muted">{hint}</span>
      </span>
    </button>
  );
}

export default function PreferencesClient() {
  const { user, loading: userLoading, error: userError } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const reduceMotion = useReducedMotion();

  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);

  const [roleFamily, setRoleFamily] = useState("");
  const [roleLevel, setRoleLevel] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [toleranceYears, setToleranceYears] = useState("");
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode[]>([]);
  const [opportunityTypes, setOpportunityTypes] = useState<OpportunityType[]>([]);
  const [effectiveSince, setEffectiveSince] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ preferences: Preferences | null }>("/api/preferences")
      .then((res) => {
        const p = res.preferences;
        if (p) {
          setRoleFamily(p.roleFamily ?? "");
          setRoleLevel(p.roleLevel ?? "");
          setYearsExperience(p.yearsExperience?.toString() ?? "");
          setToleranceYears(p.toleranceYears?.toString() ?? "");
          setCountry(p.country ?? "");
          setState(p.state ?? "");
          setCity(p.city ?? "");
          setWorkMode(p.workMode);
          setOpportunityTypes(p.opportunityTypes);
          setEffectiveSince(p.effectiveSince);
        }
      })
      .finally(() => setLoaded(true));
  }, [user]);

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await apiFetch<{ preferences: Preferences }>("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          roleFamily,
          roleLevel,
          yearsExperience: yearsExperience === "" ? null : Number(yearsExperience),
          toleranceYears: toleranceYears === "" ? null : Number(toleranceYears),
          country,
          state,
          city,
          workMode,
          opportunityTypes,
        }),
      });
      setEffectiveSince(res.preferences.effectiveSince);
      // The first save flips hasPreferences true, which the dashboard's
      // notification gate banner reads.
      invalidateCurrentUser();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your preferences. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (await save()) setSaved(true);
  }

  async function onWizardNext() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    if (await save()) router.push("/companies?onboarding=1");
  }

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
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-96" />
          <Skeleton className="mt-8 h-32 w-full" />
        </main>
      </>
    );
  }

  /* ------------------------------------------------------------ onboarding */
  if (isOnboarding) {
    const current = STEPS[step];
    const slide = reduceMotion ? {} : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 } };

    return (
      <>
        <AuthNav />
        <main className="container-app py-10 sm:py-14">
          <div className="mx-auto max-w-xl">
            {/* Progress: one segment per question, so "how much is left" is
                visible at a glance rather than stated in words only. The
                sixth segment is the company picker that follows this
                wizard -- onboarding is one six-step flow, not a five-step
                flow plus a surprise. */}
            <div className="flex items-center gap-2">
              {Array.from({ length: TOTAL_ONBOARDING_STEPS }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300",
                    i <= step ? "bg-brand" : "bg-tint-strong",
                  )}
                />
              ))}
            </div>
            <p className="mt-3 text-[0.75rem] font-medium text-ink-faint">
              Step {step + 1} of {TOTAL_ONBOARDING_STEPS}
            </p>

            <AnimatePresence mode="wait">
              <motion.div key={current.key} {...slide} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
                <h1 className="mt-5 text-[1.55rem] font-semibold leading-tight tracking-tight text-ink">
                  {current.question}
                </h1>

                <div className="mt-7">
                  {current.key === "role" && (
                    <div className="space-y-4">
                      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
                        We match on the start of a job&apos;s role family, so &ldquo;Software Engineer&rdquo; also
                        catches &ldquo;Software Engineer, Payments&rdquo;. Leave blank to hear about every role.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="roleFamily">Role</Label>
                          <Input
                            id="roleFamily"
                            autoFocus
                            placeholder="Software Engineer"
                            value={roleFamily}
                            onChange={(e) => setRoleFamily(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="roleLevel">Level (optional)</Label>
                          <Input
                            id="roleLevel"
                            placeholder="Senior"
                            value={roleLevel}
                            onChange={(e) => setRoleLevel(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {current.key === "experience" && (
                    <div className="space-y-4">
                      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
                        We&apos;ll match roles within your years of experience, give or take your tolerance. Roles that
                        don&apos;t state a requirement are never excluded.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="yearsExperience">Years of experience</Label>
                          <Input
                            id="yearsExperience"
                            autoFocus
                            type="number"
                            min={0}
                            max={60}
                            placeholder="3"
                            value={yearsExperience}
                            onChange={(e) => setYearsExperience(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="toleranceYears">Tolerance (± years)</Label>
                          <Input
                            id="toleranceYears"
                            type="number"
                            min={0}
                            max={20}
                            placeholder="2"
                            value={toleranceYears}
                            onChange={(e) => setToleranceYears(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {current.key === "location" && (
                    <div className="space-y-4">
                      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
                        Fill in the most specific one that matters to you — city wins over region, region over country.
                        Leave blank if location isn&apos;t a constraint.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="city">City</Label>
                          <Input
                            id="city"
                            autoFocus
                            placeholder="Bangalore"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="state">State / region</Label>
                          <Input
                            id="state"
                            placeholder="Karnataka"
                            value={state}
                            onChange={(e) => setState(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 sm:max-w-[calc(50%-0.5rem)]">
                        <Label htmlFor="country">Country</Label>
                        <Input
                          id="country"
                          placeholder="India"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {current.key === "workMode" && (
                    <div className="space-y-4">
                      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
                        Pick any that work for you. Select none to accept all arrangements.
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        {WORK_MODES.map((m) => (
                          <OptionTile
                            key={m.value}
                            active={workMode.includes(m.value)}
                            label={m.label}
                            hint={m.hint}
                            onClick={() => setWorkMode(toggle(workMode, m.value))}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {current.key === "opportunity" && (
                    <div className="space-y-4">
                      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
                        This one is a hard gate: internships and contracts only ever reach you if you ask for them.
                        Selecting nothing means full-time only.
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {OPPORTUNITY_TYPES.map((o) => (
                          <OptionTile
                            key={o.value}
                            active={opportunityTypes.includes(o.value)}
                            label={o.label}
                            hint={o.hint}
                            onClick={() => setOpportunityTypes(toggle(opportunityTypes, o.value))}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            {error && (
              <Alert variant="destructive" className="mt-6">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || saving}
                className="gap-1.5 text-ink-muted"
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
              <Button onClick={onWizardNext} disabled={saving} className="gap-1.5">
                {saving ? "Saving…" : step === STEPS.length - 1 ? "Save and continue" : "Continue"}
                {!saving && <ArrowRight className="size-3.5" />}
              </Button>
            </div>
          </div>
        </main>
      </>
    );
  }

  /* ------------------------------------------------------------- edit mode */
  return (
    <>
      <AuthNav />
      <main className="container-app py-9 sm:py-11">
        <header>
          <h1 className="text-[1.6rem] font-semibold tracking-tight text-ink">Job preferences</h1>
          <p className="mt-1.5 max-w-xl text-[0.88rem] leading-relaxed text-ink-muted">
            An alert is sent only when a new opening matches everything here. Leave a field blank to stop filtering on
            it.
          </p>
        </header>

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <Alert className="mt-6 border-brand/25 bg-brand-tint text-brand-ink">
            <CheckCircle2 className="text-brand" />
            <AlertDescription className="text-brand-ink">
              Saved. Matching now uses these preferences.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={onEditSubmit} className="mt-8 space-y-9">
          <section>
            <h2 className="eyebrow">Role</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="roleFamily">Role</Label>
                <Input
                  id="roleFamily"
                  placeholder="Software Engineer"
                  value={roleFamily}
                  onChange={(e) => setRoleFamily(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="roleLevel">Level</Label>
                <Input
                  id="roleLevel"
                  placeholder="Senior"
                  value={roleLevel}
                  onChange={(e) => setRoleLevel(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Experience</h2>
            <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-ink-muted">
              Matched within your years ± tolerance. Roles that don&apos;t state a requirement are never excluded.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="yearsExperience">Years of experience</Label>
                <Input
                  id="yearsExperience"
                  type="number"
                  min={0}
                  max={60}
                  placeholder="3"
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="toleranceYears">Tolerance (± years)</Label>
                <Input
                  id="toleranceYears"
                  type="number"
                  min={0}
                  max={20}
                  placeholder="2"
                  value={toleranceYears}
                  onChange={(e) => setToleranceYears(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Location</h2>
            <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-ink-muted">
              The most specific field you fill in is the one that governs.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" placeholder="Bangalore" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="state">State / region</Label>
                <Input id="state" placeholder="Karnataka" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="country">Country</Label>
                <Input id="country" placeholder="India" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Work setup</h2>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
              {WORK_MODES.map((m) => (
                <OptionTile
                  key={m.value}
                  active={workMode.includes(m.value)}
                  label={m.label}
                  hint={m.hint}
                  onClick={() => setWorkMode(toggle(workMode, m.value))}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Opportunity type</h2>
            <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-ink-muted">
              Internships and contracts only reach you if selected. Selecting nothing means full-time only.
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {OPPORTUNITY_TYPES.map((o) => (
                <OptionTile
                  key={o.value}
                  active={opportunityTypes.includes(o.value)}
                  label={o.label}
                  hint={o.hint}
                  onClick={() => setOpportunityTypes(toggle(opportunityTypes, o.value))}
                />
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save preferences"}
            </Button>
            {effectiveSince && (
              <p className="text-[0.78rem] text-ink-faint">
                Last changed {new Date(effectiveSince).toLocaleDateString(undefined, { dateStyle: "medium" })}. Only
                roles found after that point can trigger an alert.
              </p>
            )}
          </div>
        </form>
      </main>
    </>
  );
}
