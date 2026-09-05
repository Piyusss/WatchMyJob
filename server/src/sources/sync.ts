import type { JobSource } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getAdapter } from "./registry.js";
import { computeContentHash, computeIdentityHash } from "./hash.js";
import { evaluateMissedJob, isCircuitBreakerTripped } from "./closure.js";
import { classifyJob } from "./classify.js";
import { matchJobAgainstSubscribers } from "../matching/engine.js";

// The exact field set the matching engine (Phase 9) actually reads. A raw
// contentHash change (title/location/workMode/description, per hash.ts)
// fires on routine, matching-irrelevant edits too: a typo fix in the
// description, a location string reformatted with the same meaning. Using
// contentHash alone to decide "this job just became newly relevant" would
// make lastMatchRelevantChangeAt fire far more often than something
// actually changed from a matcher's point of view, which is exactly the
// signal the notify predicate's eligibility fallback depends on being
// trustworthy.
const MATCH_RELEVANT_SELECT = {
  roleFamily: true,
  level: true,
  location: true,
  workMode: true,
  opportunityType: true,
  experienceStatus: true,
  requiredExperienceMin: true,
  requiredExperienceMax: true,
} as const;

type MatchRelevantFields = {
  roleFamily: string | null;
  level: string | null;
  location: string | null;
  workMode: string | null;
  opportunityType: string;
  experienceStatus: string;
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
};

function matchRelevantFieldsChanged(before: MatchRelevantFields, after: MatchRelevantFields): boolean {
  return (Object.keys(MATCH_RELEVANT_SELECT) as (keyof MatchRelevantFields)[]).some((key) => before[key] !== after[key]);
}

export interface SourceSyncResult {
  sourceId: string;
  platform: string;
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
  // A CLOSED job whose externalJobId reappeared in this cycle's discovery:
  // reopened, not recreated (the unique constraint on
  // (sourceId, externalJobId) means it couldn't be a new row anyway).
  reactivated: number;
  // Currently-ACTIVE jobs for this source that were not rediscovered this
  // cycle. null when the fetch was PARTIAL: absence proves nothing then,
  // so it's not even counted, and null also when the circuit breaker below
  // trips (missing is real, but not trustworthy enough to act on).
  missing: number | null;
  // How many of this cycle's missing jobs crossed the close threshold:
  // see src/sources/closure.ts for the exact rule.
  closed: number;
  // True when an anomalous fraction of previously-active jobs went missing
  // at once: the source likely broke, not the jobs. When true, no miss
  // counters were touched and nothing closed this cycle.
  circuitBreakerTripped: boolean;
  // Notification rows newly queued this cycle across every matchableJobId:
  // see matching/engine.ts. Never counts a baseline (initial-sync) job,
  // which never enters matchableJobIds at all.
  queued: number;
  consecutiveFailures: number;
  error: string | null;
}

interface SyncOptions {
  // An initial sync establishes the source's baseline: every job it finds
  // already existed before JobDrop watched this source, so the rows are
  // flagged and can never fire a "new opening" notification.
  initial?: boolean;
  // A source can genuinely have zero open roles right now: that's not an
  // error. But a fetch that succeeds with zero results is indistinguishable
  // from one that silently returned bad/partial data, and getting this
  // wrong is unrecoverable: once initialSyncCompletedAt is set, every job
  // this source turns up afterwards is treated as brand-new. Require an
  // explicit operator confirmation for the empty case rather than trusting
  // it silently.
  allowEmpty?: boolean;
}

function errorResult(source: JobSource, error: string, consecutiveFailures: number): SourceSyncResult {
  return {
    sourceId: source.id,
    platform: source.platform,
    discovered: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
    missing: null,
    closed: 0,
    circuitBreakerTripped: false,
    queued: 0,
    consecutiveFailures,
    error,
  };
}

// One source's discover -> diff-against-Postgres -> persist pass. Diffs
// against the CURRENT DB state for this source (not adapter-local state, not
// last cycle's in-memory result) so a restarted scheduler or a manual
// admin:sync mid-cycle sees exactly the same picture. Kept as its own
// function so both the scheduler and the manual CLIs call exactly this, not
// separate reimplementations.
// Finalizes the SyncRun row created at the start of an attempt. Called from
// every exit path of syncSource (there are several: guard rejections
// aside, which never create a row at all) so a RUNNING row never outlives
// the attempt it represents; a row still RUNNING past a sane duration is
// exactly the "process died mid-sync" signal admin:health surfaces.
async function finalizeSyncRun(
  syncRunId: string,
  startedAt: Date,
  patch: {
    status: "SUCCESS" | "PARTIAL" | "FAILED";
    error?: string | null;
    jobsDiscovered?: number;
    jobsCreated?: number;
    jobsUpdated?: number;
    jobsClosed?: number;
    jobsReactivated?: number;
  },
) {
  const finishedAt = new Date();
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: patch.status,
      error: patch.error ?? null,
      jobsDiscovered: patch.jobsDiscovered ?? 0,
      jobsCreated: patch.jobsCreated ?? 0,
      jobsUpdated: patch.jobsUpdated ?? 0,
      jobsClosed: patch.jobsClosed ?? 0,
      jobsReactivated: patch.jobsReactivated ?? 0,
    },
  });
}

export async function syncSource(source: JobSource, options: SyncOptions = {}): Promise<SourceSyncResult> {
  const initial = options.initial ?? false;

  // Ordering guard. A regular sync against a source that never established
  // a baseline would import its entire pre-existing inventory as brand-new
  // openings: the exact flood the onboarding rule exists to prevent.
  // No SyncRun row is created for a guard rejection: no fetch was ever
  // attempted, so there's no attempt to record.
  if (!initial && source.initialSyncCompletedAt === null) {
    return errorResult(source, "Source has not completed its initial sync yet; run admin:initial-sync first", source.consecutiveFailures);
  }

  // An initial sync is once per source, by definition. Re-running it would
  // re-stamp the baseline and mislabel genuinely new jobs as pre-existing.
  if (initial && source.initialSyncCompletedAt !== null) {
    return errorResult(source, "Source has already completed its initial sync", source.consecutiveFailures);
  }

  const attemptStartedAt = new Date();
  // Marked before the fetch, not after: pollIntervalSeconds governs how
  // often a source is ATTEMPTED, not how often it succeeds: a failing
  // source is still retried on schedule, and a slow in-flight fetch won't
  // look "overdue" to the next scheduler tick just because it hasn't
  // finished yet.
  await prisma.jobSource.update({ where: { id: source.id }, data: { lastAttemptedAt: attemptStartedAt } });
  // Written before the adapter is ever called: see SyncRunStatus's
  // RUNNING comment in schema.prisma.
  const syncRun = await prisma.syncRun.create({ data: { sourceId: source.id } });

  let discovery;
  try {
    const adapter = getAdapter(source.platform);
    discovery = await adapter.discoverJobs({ id: source.id, companyId: source.companyId, config: source.config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { consecutiveFailures } = await prisma.jobSource.update({
      where: { id: source.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    await finalizeSyncRun(syncRun.id, attemptStartedAt, { status: "FAILED", error: message });
    return errorResult(source, message, consecutiveFailures);
  }

  const { jobs: normalized, status: fetchStatus } = discovery;

  if (initial && normalized.length === 0 && !options.allowEmpty) {
    const message =
      "Initial sync found 0 jobs. This could be a genuinely empty board, or a fetch that silently returned " +
      "incomplete data: re-run with allowEmpty to confirm the board really has no openings right now.";
    await finalizeSyncRun(syncRun.id, attemptStartedAt, { status: "FAILED", error: message });
    return errorResult(source, message, source.consecutiveFailures);
  }

  const now = new Date();

  // A second syncSource call for this SAME source (a manual admin:sync
  // overlapping the scheduled worker, most plausibly) can genuinely race
  // this transaction at the database level: both read "no existing row"
  // before either commits, both attempt the INSERT, and Postgres rejects
  // the second with a real unique-constraint violation (23505) once the
  // first commits. That's an ordinary, recoverable condition here (this
  // cycle failed, the next one will simply see the row the other
  // transaction created), not a reason to crash the process: caught the
  // same way an adapter fetch failure is.
  let diffResult;
  try {
    diffResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.job.findMany({
        where: { sourceId: source.id, status: { in: ["ACTIVE", "CLOSED"] } },
        select: {
          id: true,
          externalJobId: true,
          contentHash: true,
          status: true,
          consecutiveMissCount: true,
          firstMissingAt: true,
          ...MATCH_RELEVANT_SELECT,
        },
      });

      // Only ACTIVE rows count toward "missing": a CLOSED job simply not
      // reappearing is not a new event, it's the status quo.
      const activeCount = existing.filter((j) => j.status === "ACTIVE").length;
      const remaining = new Map(existing.filter((j) => j.status === "ACTIVE").map((j) => [j.externalJobId, j]));
      const closedByExternalId = new Map(existing.filter((j) => j.status === "CLOSED").map((j) => [j.externalJobId, j]));

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let reactivated = 0;
      // Every job whose matchable state just became true or changed this
      // cycle: what the matching engine (Phase 9) re-evaluates against
      // every subscriber afterward. Deliberately excludes "unchanged" and
      // matching-irrelevant updates (see matchRelevantFieldsChanged).
      const matchableJobIds: string[] = [];

      for (const job of normalized) {
        const identityHash = computeIdentityHash(source.companyId, job);
        const contentHash = computeContentHash(job);
        const activeMatch = remaining.get(job.externalJobId);
        remaining.delete(job.externalJobId);
        const closedMatch = closedByExternalId.get(job.externalJobId);

        const classification = classifyJob(job);

        const mutableFields = {
          identityHash,
          contentHash,
          title: job.title,
          location: job.location,
          workMode: job.workMode,
          description: job.description,
          sourceUrl: job.sourceUrl,
          postedAt: job.postedAt,
          ...classification,
        };

        if (activeMatch) {
          // Rediscovered while still ACTIVE: whatever miss streak it was
          // partway through (missed a cycle or two, then reappeared) is
          // over. Reset unconditionally on every rediscovery, not just on
          // reactivation from CLOSED: "consecutive" has to mean
          // consecutive, or a job that flickers over months would
          // eventually accumulate enough non-consecutive misses to close.
          const resetMissState = { consecutiveMissCount: 0, firstMissingAt: null };

          if (activeMatch.contentHash !== contentHash) {
            const relevantChange = matchRelevantFieldsChanged(activeMatch, mutableFields);
            await tx.job.update({
              where: { id: activeMatch.id },
              data: {
                ...mutableFields,
                ...resetMissState,
                lastSeenAt: now,
                ...(relevantChange ? { lastMatchRelevantChangeAt: now } : {}),
              },
            });
            if (relevantChange) matchableJobIds.push(activeMatch.id);
            updated++;
          } else {
            await tx.job.update({ where: { id: activeMatch.id }, data: { ...resetMissState, lastSeenAt: now } });
            unchanged++;
          }
        } else if (closedMatch) {
          // externalJobId is unique per source regardless of status, so a
          // "new" job with an id that belonged to a closed one is by
          // definition the same row reopening, not a fresh posting. See
          // schema.prisma's Job.consecutiveMissCount comment: this is the
          // repost/requisition-reuse case the closure algorithm has to
          // survive without violating the unique constraint.
          await tx.job.update({
            where: { id: closedMatch.id },
            data: {
              ...mutableFields,
              status: "ACTIVE",
              lastSeenAt: now,
              // A reopened job is newly-relevant the same way an updated
              // one is: firstSeenAt (write-once) can't move, so this is
              // what a future notify predicate keys off instead.
              lastMatchRelevantChangeAt: now,
              consecutiveMissCount: 0,
              firstMissingAt: null,
            },
          });
          reactivated++;
          matchableJobIds.push(closedMatch.id);
        } else {
          const createdJob = await tx.job.create({
            data: {
              companyId: source.companyId,
              sourceId: source.id,
              externalJobId: job.externalJobId,
              ...mutableFields,
              discoveredInInitialSync: initial,
              firstSeenAt: now,
              lastSeenAt: now,
            },
            select: { id: true },
          });
          created++;
          // A baseline job (discoveredInInitialSync) is pre-existing
          // inventory by definition: it must never enter the matching
          // pass at all, or it would be evaluated and could notify anyone
          // subscribed since before this sync, defeating the entire
          // baseline flag. See its comment in schema.prisma.
          if (!initial) matchableJobIds.push(createdJob.id);
        }
      }

      // Whatever's left in `remaining` is ACTIVE in the DB but wasn't in
      // this cycle's discovery. Only trustworthy when the fetch itself was
      // known-complete: a PARTIAL or failed fetch proves nothing about
      // absence.
      if (fetchStatus !== "COMPLETE") {
        return { created, updated, unchanged, reactivated, missing: null, closed: 0, circuitBreakerTripped: false, matchableJobIds };
      }

      const missingJobs = [...remaining.values()];
      const tripped = isCircuitBreakerTripped(activeCount, missingJobs.length);

      let closed = 0;
      if (!tripped) {
        for (const job of missingJobs) {
          const evaluation = evaluateMissedJob(
            { consecutiveMissCount: job.consecutiveMissCount, firstMissingAt: job.firstMissingAt },
            now,
          );
          await tx.job.update({
            where: { id: job.id },
            data: {
              consecutiveMissCount: evaluation.consecutiveMissCount,
              firstMissingAt: evaluation.firstMissingAt,
              status: evaluation.shouldClose ? "CLOSED" : "ACTIVE",
            },
          });
          if (evaluation.shouldClose) closed++;
        }
      }
      // Tripped: deliberately leave every missing job's miss-tracking state
      // untouched this cycle: the anomaly gets reported, not acted on.

      return {
        created,
        updated,
        unchanged,
        reactivated,
        missing: missingJobs.length,
        closed,
        circuitBreakerTripped: tripped,
        matchableJobIds,
      };
    },
    // Prisma's 5s interactive-transaction default is not enough for a first
    // sync of a large board: every row is an INSERT carrying a full job
    // description. Elastic (365 jobs) failed on it every time, and Datadog
    // (441) and MongoDB (415) only just cleared it, so the default was
    // leaving big boards flaky rather than merely slow.
    //
    // Raised rather than split into batches on purpose: the whole diff has
    // to commit or roll back as one unit, otherwise a half-imported
    // inventory becomes visible and the rest of the import reads as new
    // openings, which is exactly what the baseline gate below exists to
    // prevent.
    { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    const message = `Failed to persist discovered jobs, possibly a concurrent sync of the same source: ${err instanceof Error ? err.message : String(err)}`;
    const { consecutiveFailures } = await prisma.jobSource.update({
      where: { id: source.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    await finalizeSyncRun(syncRun.id, attemptStartedAt, { status: "FAILED", error: message, jobsDiscovered: normalized.length });
    return errorResult(source, message, consecutiveFailures);
  }
  const { created, updated, unchanged, reactivated, missing, closed, circuitBreakerTripped, matchableJobIds } =
    diffResult;

  await finalizeSyncRun(syncRun.id, attemptStartedAt, {
    status: fetchStatus === "COMPLETE" ? "SUCCESS" : "PARTIAL",
    jobsDiscovered: normalized.length,
    jobsCreated: created,
    jobsUpdated: updated,
    jobsClosed: closed,
    jobsReactivated: reactivated,
  });

  // Only now, after every discovered job is committed, does the source
  // count as having a baseline. Marking it earlier would let a subscription
  // be created against a half-imported inventory, and the rest of the
  // import would then look like new openings.
  await prisma.jobSource.update({
    where: { id: source.id },
    data: {
      consecutiveFailures: 0,
      lastSuccessAt: now,
      ...(initial ? { initialSyncCompletedAt: now } : {}),
    },
  });

  // Deliberately after the sync transaction commits, not inside it: matching
  // reads other tables (subscriptions, preferences) and writes Notification
  // rows, a separate concern from "did this source's jobs get persisted."
  // Sequential per job, matching this function's own reasoning elsewhere:
  // simple and correct beats clever at this scale.
  let queued = 0;
  for (const jobId of matchableJobIds) {
    queued += await matchJobAgainstSubscribers(jobId);
  }

  return {
    sourceId: source.id,
    platform: source.platform,
    discovered: normalized.length,
    created,
    updated,
    unchanged,
    reactivated,
    missing,
    closed,
    circuitBreakerTripped,
    queued,
    consecutiveFailures: 0,
    error: null,
  };
}

async function loadCompanyWithSources(companySlug: string) {
  const company = await prisma.company.findUnique({
    where: { slug: companySlug },
    include: { sources: true },
  });
  if (!company) {
    throw new Error(`No company with slug "${companySlug}"`);
  }
  // A deactivated company has no business being synced: if it was turned
  // off deliberately (ToS revoked, broken adapter, cap rebalance), letting
  // it keep accumulating jobs in the background is never what was intended,
  // and doing so silently is how a stale-baseline flood risk (see
  // selectable.ts) accumulates unnoticed.
  if (company.status !== "ACTIVE") {
    throw new Error(`"${companySlug}" is ${company.status}, not ACTIVE: reactivate it first if this is intended`);
  }
  return company;
}

export async function syncCompany(companySlug: string): Promise<SourceSyncResult[]> {
  const company = await loadCompanyWithSources(companySlug);

  const results: SourceSyncResult[] = [];
  for (const source of company.sources) {
    // Sequential on purpose: respects each source's own rate limits rather
    // than firing every source's requests at once.
    results.push(await syncSource(source));
  }
  return results;
}

// Establishes the baseline for every source of a company that doesn't have
// one yet. A source that already has a baseline is left alone, so this is
// safe to re-run after adding a source to a live company.
export async function runInitialSync(companySlug: string, options: { allowEmpty?: boolean } = {}): Promise<SourceSyncResult[]> {
  const company = await loadCompanyWithSources(companySlug);

  const pending = company.sources.filter((s) => s.initialSyncCompletedAt === null);

  const results: SourceSyncResult[] = [];
  for (const source of pending) {
    results.push(await syncSource(source, { initial: true, allowEmpty: options.allowEmpty }));
  }
  return results;
}
