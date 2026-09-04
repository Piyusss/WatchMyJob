# Deployment & Operations

Practical guidance for running JobDrop beyond a single developer's machine. Written for where the project actually is today (no live production deployment yet) — this documents the approach, and calls out plainly which parts are proven versus which still need real infrastructure to exercise.

## Architecture recap

Three long-running processes share one Postgres database, never one monolith:

- `api` (`src/index.ts`) — the Fastify HTTP API
- `source-worker` (`src/worker.ts`) — polls job sources on their own schedule
- `notification-worker` (`src/notificationWorker.ts`) — drains the notification queue

All three are built from the same image (`server/Dockerfile`) with a different `command`. See `docker-compose.yml` for a working definition of all three plus Postgres, each with `restart: unless-stopped` for supervision.

## Environment separation

Configuration is read from environment variables via `server/src/config/env.ts` (validated with zod at startup — the process refuses to start on a missing/invalid value rather than running with a silently wrong config). `NODE_ENV` is `development` / `test` / `production`.

- **Local dev**: `server/.env`, `web/.env.local`, Postgres via `docker compose up db` on `localhost:5433`, app processes via `npm run dev*` directly on the host.
- **A real deployment** (staging/production): separate `.env` files (or a secrets manager, see below) per environment, never sharing a database or JWT secret between them. `server/.env.example` documents every variable the API needs.

## Secrets management

Today: `.env` files, gitignored (verify: `.env`, `.env.local` are in `.gitignore`; `.env.example` is intentionally tracked and contains no real values).

For an actual deployment, `.env` files on disk are the minimum acceptable, not the target — use your platform's secrets manager (AWS Secrets Manager / Parameter Store, Fly.io secrets, Railway variables, etc.) to inject `JWT_SECRET`, `DATABASE_URL`, and `SES_WEBHOOK_SECRET` at runtime instead of committing them to a file on the host. Never log these values — `src/logger.ts`'s own comment states this explicitly, and no code path in this repo logs a password, JWT, session cookie, provider credential, or unsubscribe token.

## HTTPS/TLS

Fastify itself serves plain HTTP here (`fastify.listen({ port, host: "0.0.0.0" })`) — this is normal: TLS termination is expected to happen in front of the app (a load balancer, reverse proxy, or platform-managed edge — e.g. an ALB, Cloudflare, Caddy, or nginx), not inside the Node process. Whatever fronts this in a real deployment must terminate TLS and forward plain HTTP internally; `@fastify/cors`'s `origin` check (currently `FRONTEND_URL`) and cookie `secure` flag both need to reflect the real public HTTPS origin once one exists.

## Database migrations

Discipline already in place, worth stating explicitly:

- Schema changes go through `prisma migrate dev --name <description>` in development, committed to `server/prisma/migrations/`.
- A real deployment runs `prisma migrate deploy` (applies pending migrations, never generates new ones) — this is what `server/package.json`'s `db:deploy` script does.
- Never hand-edit a migration that has already been applied anywhere outside local dev.
- Two migrations in this project's history (`enforce_first_seen_at_immutable`, `protect_baseline_flag`) hand-write raw SQL (a Postgres trigger) alongside Prisma's generated DDL — this is the documented, correct way to add DB-level invariants Prisma's schema language can't express on its own.

## Backups

`scripts/backup-db.sh` and `scripts/restore-db.sh`, run from the repo root against the `db` docker-compose service:

```sh
./scripts/backup-db.sh [output-dir]      # defaults to ./backups
./scripts/restore-db.sh <dump-file>      # DESTRUCTIVE -- prompts for confirmation
```

**This has been tested for real**, not just written: a live backup was taken of the actual dev database, restored into a separate throwaway database (`jobdrop_restore_test`), and its row counts (13 companies, 3217 jobs, 19 users at test time) were confirmed to match the source exactly before the throwaway database was dropped. The restore script itself is destructive by design (it drops and recreates the target schema) — it was not run against the live database in that test; a temporary target was used instead, which is the recommended way to rehearse a restore going forward too.

`backups/` is gitignored — dump files contain real user data (emails, password hashes) and must never be committed.

Recommended cadence for a real deployment: a daily automated `backup-db.sh` run (cron, or your platform's scheduled-task equivalent) with retention (e.g. 7 daily + 4 weekly), stored somewhere other than the same host as the database.

## Health checks & alerting

- `GET /health` — liveness/readiness probe, unauthenticated by convention, deliberately coarse (counts only): database connectivity, count of sources at/past the failure-alert threshold, count of DEAD_LETTER and QUEUED notifications. Returns 503 if the database is unreachable.
- `npm run admin:health` — the detailed operator view (per-source status, recent `SyncRun` history, last error text). No HTTP surface by design; run on a machine with database access.
- Both workers and the API now log structured JSON (via `pino`) with an explicit `event` field per line — `source_sync_attempt`, `source_health_alert`, `notification_tick`, `notification_dead_letter_alert`, etc. A source past the consecutive-failure threshold or a tick that dead-letters a notification logs at `error` level specifically so it's easy to filter for.
- **Not yet wired to a real alerting channel.** The structured `error`-level log lines above are the foundation for that (grep-able today, and exactly what you'd point a log-based alert rule at) — routing them to Slack/PagerDuty/email is a small, real next step once there's a deployment target to alert about.

## Notification delivery feedback

`POST /api/webhooks/ses` receives SES delivery/bounce/complaint events via an SNS topic subscription, updating `Notification.status` to `DELIVERED` / `BOUNCED` / `COMPLAINED` and suppressing future sends (`User.emailHardBounced`) on a permanent bounce or a complaint. The route and its logic are implemented and tested (`server/src/notifications/webhooks.test.ts`, via a real Fastify instance), but — like `SesEmailProvider` itself — **unverified against a live SNS subscription**, since this environment has no AWS account or SNS topic to confirm one against. Full SNS message-signature verification is deliberately not implemented (it requires fetching and caching AWS's rotating signing certificate); the endpoint instead expects a shared secret as `?token=...`, set via `SES_WEBHOOK_SECRET` once a real subscription exists.

## What's genuinely untested here

Stated plainly rather than implied: the SES send path and the SES webhook path are both built correctly against AWS's documented interfaces, but neither has been exercised against real AWS infrastructure in this environment (no AWS credentials, no SES-verified domain, no SNS topic). Everything else on this page — the backup/restore cycle, the Docker Compose service definitions, the migration workflow, the health check — has been run for real, not just written.
