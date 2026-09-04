# JobDrop — Implementation Status

What has actually been built so far, backend and frontend. Not a plan, not aspirational — this is the current state of the code.

## Backend (server/)

### Infrastructure
- Fastify 5 + TypeScript (ESM) API server
- PostgreSQL 16 via Docker Compose, Prisma ORM
- Separate worker processes: source poller (`worker.ts`), notification sender (`notificationWorker.ts`), apart from the API server (`index.ts`)
- Clerk-managed authentication (Google + email/password, verification, sessions) — `@clerk/fastify`'s `clerkPlugin` verifies the bearer token on every request; the API never sees a password
- Rate limiting (600/min per IP, `/health` exempt) as generic abuse protection — the endpoints actually worth brute-forcing are Clerk's now and are throttled on their side
- CORS configured

### Data model (Prisma)
- `User` — clerkUserId (unique, join key to Clerk), email, name, phone, linkedinUrl, githubUrl, emailVerified, notificationsPaused, unsubscribeToken. Lazily provisioned on a user's first authenticated request (see `auth/authenticate.ts`) rather than via a Clerk webhook — no public URL for Clerk to call in local dev.
- `Company` — name, slug, status, accessBasis
- `JobSource` — platform, config, polling interval, initialSyncCompletedAt, consecutiveFailures, lastAttemptedAt
- `Job` — identity/content hashes, role classification, location, work mode, opportunity type, experience range, status, firstSeenAt/lastSeenAt/lastMatchRelevantChangeAt, miss-tracking fields
- `UserPreferences` — role family/level, years experience, tolerance, country/state/city, work modes, opportunity types, effectiveSince
- `UserCompanySubscription`
- `Notification` — states SENDING/PROVIDER_ACCEPTED/FAILED/SKIPPED/DEAD_LETTER, attemptCount, lastError, nextAttemptAt, providerMessageId
- DB-level triggers enforcing write-once columns (firstSeenAt, discoveredInInitialSync) so they can't be silently overwritten
- Unique DB constraint enforcing notification idempotency (userId, jobId, notificationType)

### Job source adapters
- Adapter interface pattern (`JobSourceAdapter`), one adapter per ATS platform
- Greenhouse adapter — real public board API integration
- Lever adapter — real public postings API integration, maps structured workplaceType/commitment fields directly
- Per-platform config validation via zod
- Adapter registry with a test-injection seam (`setAdapterForTesting`)

### Sync engine
- Diff-based sync: classifies each discovered job as new/updated/unchanged/missing against existing DB state
- Initial sync / baseline establishment, with an empty-baseline guard (`allowEmpty` flag required to commit a zero-job baseline)
- Source-level baseline gating (`initialSyncCompletedAt`) — a company isn't user-selectable until every one of its sources has a committed baseline
- Closure/circuit-breaker algorithm: consecutive-miss counting + time floor before closing a job, plus a source-level circuit breaker against mass false closure
- Reactivation handling — a closed job's externalJobId reappearing is treated as reactivation, not a unique-constraint crash
- Match-relevant field change tracking (`lastMatchRelevantChangeAt`), narrowed to fields that actually affect matching, not every content edit
- Concurrent-sync safety — two overlapping syncs of the same source can't double-insert or crash uncaught
- Inactive-company guard — sync refuses to run against a deactivated company

### Job classification (deterministic, not LLM)
- Title-based role family and level extraction
- HTML-entity-aware description-to-text parsing
- Regex-based experience extraction (required/preferred min/max years), documented first-match-wins policy
- Opportunity type detection — title-based, with a structured hint channel (used by Lever's commitment field) taking priority when present

### Matching
- Pure matching predicate (role family, level, location, work mode, opportunity type, experience-with-tolerance)
- Eligibility/timing logic kept separate from the predicate (decides whether a match should notify based on subscription/preference timing)
- Matching engine: match one job against all subscribers, and match one user against all their currently-active jobs
- Notification idempotency via atomic `createMany({skipDuplicates:true})` against the DB unique constraint, not check-then-insert

### Notifications
- Email provider abstraction — Brevo (live, primary), Resend and AWS SES v2 as fallbacks, console provider for local dev with none configured
- Email templates: job-match email (account verification is Clerk's own, sent outside this pipeline)
- Delivery pipeline: queue via Postgres `SELECT ... FOR UPDATE SKIP LOCKED` for atomic batch claiming
- Exponential backoff with a retry ceiling, reaching DEAD_LETTER after exhaustion
- SENDING state persisted before the external send call (crash safety)
- Reconciliation for notifications stuck in SENDING past a threshold
- Pre-send recheck (company still active, user not paused, email still verified) done right before sending, separate from the match-time check
- Public unsubscribe endpoint using a stable, non-expiring per-user token

### Account management
- Notifications pause/resume toggle
- Account deletion — deletes the Clerk account and the local row together (see `account/routes.ts`); the Clerk session itself is the confirmation, no separate password step
- Full data export as JSON

### Admin CLIs (no HTTP surface, direct DB scripts)
- `admin:companies` — add / list / activate / deactivate
- `admin:sources` — add / list job sources for a company
- `admin:sync` — manually trigger a sync
- `admin:initial-sync` — run baseline sync (with `--allow-empty` override)
- `admin:health` — health check script
- `admin:reclassify` — re-run classification on existing jobs

### API endpoints
- `GET /api/auth/me` (registration/login/logout/verification/reset are Clerk's — no server endpoints for them)
- `GET /api/preferences`, `PUT /api/preferences`
- `GET /api/companies` (includes live open-role counts)
- `GET /api/subscriptions`, `POST /api/subscriptions`, `DELETE /api/subscriptions/:slug`
- `GET /api/jobs` (filtered by saved preferences when present, reports both matched and unfiltered totals)
- `GET /api/account/export`, `PATCH /api/account/notifications`, `DELETE /api/account`
- `POST /api/notifications/unsubscribe`

### Testing
- 141 automated tests across 29 suites (`node:test`), all passing
- Fixture-based adapter tests using real recorded Greenhouse/Lever API responses, global fetch mocked (never hits live sites in the test suite)
- Coverage includes: classification, matching predicate/eligibility/engine, closure/circuit-breaker (unit + integration), empty-baseline guard, inactive-company guard, concurrent-sync races, consecutive-failure tracking, HTML-to-text parsing, onboarding no-flood invariants

### Companies configured with real, live data
13 companies, all with a committed baseline and real synced jobs: Figma, Discord, Palantir, LinkedIn, Postman, Rubrik, Cloudflare, Zscaler, Databricks, Stripe, Airbnb, Dropbox, Spotify (~3,700+ real job postings total).

## Frontend (web/)

### Stack
- Next.js 16 (App Router) + React 18 + TypeScript
- Tailwind CSS v4
- shadcn/ui components (built on Base UI primitives)
- Framer Motion for animation
- lucide-react for icons

### Pages
- `/` — landing page (animated hero, company marquee, how-it-works, principles)
- `/register`, `/login` — two-panel auth layout wrapping Clerk's `<SignUp>`/`<SignIn>` (Google + email/password; verification and password reset happen inline, Clerk's own)
- `/dashboard` — job feed filtered by saved preferences, stat cards, search, verification/onboarding banners
- `/preferences` — onboarding mode and edit mode (role, experience, location, work mode, opportunity type)
- `/companies` — company watchlist with avatars and live open-role counts
- `/settings` — notification pause toggle, data export, account deletion (confirmation dialog)
- `/unsubscribe` — standalone confirmation page (still on the pre-shadcn styling, not yet migrated)

### Components
- `AuthNav`, `AuthShell` (custom)
- shadcn components in use: Button, Card, Input, Label, Badge, Checkbox, Avatar, Separator, Dialog, DropdownMenu, Sonner (toast), Skeleton, Tabs, Select, Switch, Alert, Tooltip

### Functional behavior
- Mandatory onboarding flow: register/login → preferences → companies → dashboard, enforced by redirect
- Backend-driven `hasPreferences` flag gates matching/notifications; frontend surfaces this with a dashboard banner if skipped
- Dashboard job list is filtered through the same `matchesPreferences` predicate that drives notifications, not just "everything at watched companies"
- Dashboard reports both matched-job count and total-open-at-watched-companies count
- Client-side search over the dashboard job list (title/company/location)
- Deterministic per-company avatar colors
- Email verification banner (rare in practice — Clerk gates sign-in on a verified email already) with a "Verify email" action that opens Clerk's own account portal
- Toggleable notification pause, JSON data export, account deletion via modal (Clerk session is the confirmation, no password step)

## Explicitly not done / deferred
- Workday adapter (would recover ~13 more companies: Adobe, Salesforce, Intuit, PayPal, ServiceNow, Broadcom, AMD, Qualcomm, Palo Alto Networks, Synopsys, Cadence, S&P Global, possibly Atlassian) — not started
- Companies with fully custom/proprietary career portals (Google, Meta, Amazon, Apple, Microsoft, Oracle, Cisco, Samsung, Intel, Zoho, eBay, Walmart) — no adapter path exists for these
- `/unsubscribe` page not yet rebuilt with shadcn/Tailwind (still on the original hand-written CSS)
- No Clerk `user.deleted`/`user.updated` webhook — the local `User` row is only synced from Clerk once, at first sign-in (see `auth/authenticate.ts`); it won't pick up a later name/email change made inside Clerk's own account portal
- No dark-mode toggle (tokens exist in CSS but nothing switches the `.dark` class)
- Automated application-assistance system (mini application screen, controlled browser session, auto form-filling, CAPTCHA handling, auto-submission) — out of scope per original project plan, not built
