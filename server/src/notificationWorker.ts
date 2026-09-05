// The notification worker: a third process alongside the API server
// (src/index.ts) and the poller (src/worker.ts): three processes sharing
// one Postgres, per the Phase 1 architecture note, not one monolith. Ticks
// on a short interval, draining whatever is QUEUED or due for retry.
import { processNotificationBatch } from "./notifications/pipeline.js";
import { createLogger } from "./logger.js";

const log = createLogger("notification-worker");

const TICK_INTERVAL_MS = 15_000;

async function tick() {
  const result = await processNotificationBatch();

  if (result.reconciled > 0) {
    log.warn(
      { event: "notification_reconciled", count: result.reconciled },
      `recovered ${result.reconciled} notification(s) stuck in SENDING -> DEAD_LETTER`,
    );
  }
  if (result.deadLettered > 0) {
    log.error(
      { event: "notification_dead_letter_alert", count: result.deadLettered },
      `ALERT: ${result.deadLettered} notification(s) entered DEAD_LETTER this cycle`,
    );
  }
  if (result.claimed > 0) {
    log.info(
      {
        event: "notification_tick",
        claimed: result.claimed,
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        deadLettered: result.deadLettered,
        reconciled: result.reconciled,
      },
      `claimed ${result.claimed}: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} will retry, ${result.deadLettered} dead-lettered`,
    );
  }
}

async function main() {
  log.info({ event: "worker_started", tickIntervalMs: TICK_INTERVAL_MS }, `started, checking for queued notifications every ${TICK_INTERVAL_MS / 1000}s`);

  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      log.error({ event: "notification_tick_crashed", err }, "tick failed");
    }
  };

  await loop();
  setInterval(loop, TICK_INTERVAL_MS);
}

main().catch((err) => {
  log.fatal({ err }, "worker crashed at startup");
  process.exit(1);
});
