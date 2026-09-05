// The poller/ingestion worker: a separate process from the API server (see
// the architecture note in the Phase 1 blueprint: API, poller, and
// notification worker are three processes sharing one Postgres, not one
// monolith). Ticks on a short internal interval, and on each tick syncs
// whichever sources are actually due per their OWN pollIntervalSeconds:
// that field has existed since Phase 2 and was never read by anything
// until now.
import { prisma } from "./db/prisma.js";
import { syncSource, type SourceSyncResult } from "./sources/sync.js";
import { summarizeSyncResult } from "./sources/format.js";
import { createLogger } from "./logger.js";

const log = createLogger("source-worker");

const TICK_INTERVAL_MS = 30_000;
// A source failing this many times in a row is worth an operator's
// attention: not paged, just made impossible to miss in the log, which is
// proportionate at "a script is enough at this scale."
const HEALTH_ALERT_THRESHOLD = 3;

interface DueSource {
  id: string;
  companyId: string;
  platform: string;
  companyName: string;
}

async function findDueSources(): Promise<DueSource[]> {
  const sources = await prisma.jobSource.findMany({
    where: {
      // Only a baselined source is eligible for a regular sync: syncSource
      // itself refuses otherwise, so filtering here just avoids a guaranteed
      // rejection (and its log line) every single tick.
      initialSyncCompletedAt: { not: null },
      company: { status: "ACTIVE" },
    },
    select: {
      id: true,
      companyId: true,
      platform: true,
      pollIntervalSeconds: true,
      lastAttemptedAt: true,
      company: { select: { name: true } },
    },
  });

  const now = Date.now();
  return sources
    .filter((s) => {
      if (!s.lastAttemptedAt) return true;
      const dueAt = s.lastAttemptedAt.getTime() + s.pollIntervalSeconds * 1000;
      return now >= dueAt;
    })
    .map((s) => ({ id: s.id, companyId: s.companyId, platform: s.platform, companyName: s.company.name }));
}

function logResult(due: DueSource, result: SourceSyncResult) {
  const fields = {
    event: "source_sync_attempt",
    sourceId: due.id,
    companyId: due.companyId,
    companyName: due.companyName,
    platform: due.platform,
    success: result.error === null,
    discovered: result.discovered,
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged,
    closed: result.closed,
    reactivated: result.reactivated,
    circuitBreakerTripped: result.circuitBreakerTripped,
    consecutiveFailures: result.consecutiveFailures,
  };

  if (result.error) {
    log.warn({ ...fields, error: result.error }, `sync failed: ${due.companyName} / ${due.platform}`);
    if (result.consecutiveFailures >= HEALTH_ALERT_THRESHOLD) {
      log.error(
        { ...fields, event: "source_health_alert", error: result.error },
        `ALERT: ${due.companyName} / ${due.platform} has now failed ${result.consecutiveFailures} times in a row`,
      );
    }
    return;
  }

  log.info(fields, `sync ok: ${due.companyName} / ${due.platform} · ${summarizeSyncResult(result)}`);
}

async function tick() {
  const due = await findDueSources();
  if (due.length === 0) return;

  log.info({ event: "source_tick_start", dueCount: due.length }, `${due.length} source(s) due`);

  let succeeded = 0;
  let failed = 0;
  for (const source of due) {
    // Sequential, matching syncCompany's own reasoning: respects each
    // source's rate limits rather than firing every due source at once.
    const full = await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } });
    const result = await syncSource(full);
    logResult(source, result);
    if (result.error) failed++;
    else succeeded++;
  }

  log.info({ event: "source_tick_end", succeeded, failed }, `tick complete: ${succeeded} ok, ${failed} failed`);
}

async function main() {
  log.info({ event: "worker_started", tickIntervalMs: TICK_INTERVAL_MS }, `started, checking for due sources every ${TICK_INTERVAL_MS / 1000}s`);

  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      log.error({ event: "source_tick_crashed", err }, "tick failed");
    }
  };

  await loop();
  setInterval(loop, TICK_INTERVAL_MS);
}

main().catch((err) => {
  log.fatal({ err }, "worker crashed at startup");
  process.exit(1);
});
