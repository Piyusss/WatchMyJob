// At-a-glance source health across every company: the Phase 6 deliverable
// is "a broken adapter is visibly distinct from a quiet company," which
// admin:sources (scoped to one company) doesn't give an operator on its own.
//
// Usage:
//   npm run admin:health
import { prisma } from "../db/prisma.js";

const ALERT_THRESHOLD = 3;

function ago(date: Date | null): string {
  if (!date) return "never";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const RECENT_RUNS_PER_SOURCE = 5;

async function main() {
  const sources = await prisma.jobSource.findMany({
    include: { company: { select: { name: true, status: true } } },
    orderBy: [{ consecutiveFailures: "desc" }, { company: { name: "asc" } }],
  });

  if (sources.length === 0) {
    console.log("No sources configured yet.");
    return;
  }

  const unhealthy = sources.filter((s) => s.consecutiveFailures >= ALERT_THRESHOLD);
  const noBaseline = sources.filter((s) => s.initialSyncCompletedAt === null);

  console.log(`${sources.length} source(s) across ${new Set(sources.map((s) => s.companyId)).size} companies.\n`);

  for (const s of sources) {
    const flags = [
      s.company.status !== "ACTIVE" ? "company INACTIVE" : null,
      s.initialSyncCompletedAt === null ? "no baseline yet" : null,
      s.consecutiveFailures >= ALERT_THRESHOLD ? `${s.consecutiveFailures} consecutive failures` : null,
    ].filter(Boolean);

    const marker = flags.length > 0 ? "⚠" : "●";
    console.log(
      `${marker} ${s.company.name} / ${s.platform} · poll every ${s.pollIntervalSeconds}s · ` +
        `last attempt ${ago(s.lastAttemptedAt)}, last success ${ago(s.lastSuccessAt)}` +
        (flags.length > 0 ? ` · ${flags.join(", ")}` : ""),
    );

    const recentRuns = await prisma.syncRun.findMany({
      where: { sourceId: s.id },
      orderBy: { startedAt: "desc" },
      take: RECENT_RUNS_PER_SOURCE,
      select: { status: true, startedAt: true, durationMs: true, jobsDiscovered: true, jobsCreated: true, jobsUpdated: true, jobsClosed: true, jobsReactivated: true, error: true },
    });
    if (recentRuns.length > 0) {
      const summary = recentRuns
        .map((r) => {
          const marker2 = r.status === "SUCCESS" ? "✓" : r.status === "PARTIAL" ? "◐" : r.status === "FAILED" ? "✗" : "…";
          return `${marker2}${r.status === "RUNNING" ? "" : ago(r.startedAt)}`;
        })
        .join("  ");
      console.log(`    recent: ${summary}`);
      const lastFailed = recentRuns.find((r) => r.status === "FAILED");
      if (lastFailed?.error) {
        console.log(`    last error: ${lastFailed.error.slice(0, 140)}`);
      }
    }
  }

  if (unhealthy.length > 0) {
    console.log(`\n${unhealthy.length} source(s) at or past the failure alert threshold (${ALERT_THRESHOLD}).`);
  }
  if (noBaseline.length > 0) {
    console.log(`${noBaseline.length} source(s) still waiting on an initial sync.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
