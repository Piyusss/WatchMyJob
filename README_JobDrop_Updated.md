# JobDrop

> **Never miss a relevant job opening from the companies you care about.**

JobDrop is a free job-opening monitoring and notification platform that continuously monitors a controlled set of company career portals and other permitted job sources, detects job openings, normalizes and deduplicates them, matches active openings against user preferences, and sends notifications to eligible users.

Initial operating limits:

- Supported companies: **<= 50**
- Registered users: **<= 500**
- Candidate-facing core features: **Free**

This README intentionally covers the project plan only through the **notification stage**. Automated application filling/submission is a separate future subsystem and is not part of the current implementation plan.

---

## 1. Problem

Job seekers often have to repeatedly check individual company career pages, LinkedIn, job boards, and messaging channels to find relevant openings.

Problems include:

- Users cannot manually monitor dozens of company career pages continuously.
- Relevant openings can disappear quickly.
- Generic job boards create noise.
- The same opening may appear through multiple sources.
- Users may have very specific requirements for role, level, location, experience, company, and work mode.
- A newly created JobDrop account should not be flooded with notifications for jobs that already existed before the user started monitoring.

JobDrop solves this by continuously monitoring selected sources and notifying users when a **new, active opening** matches their preferences.

---

# 2. Core Product Flow

```text
Company publishes job
        ↓
JobDrop detects it
        ↓
Normalize + deduplicate
        ↓
Check job is ACTIVE
        ↓
Match against user preferences
        ↓
Identify eligible users
        ↓
Create notification
        ↓
Queue notification
        ↓
Notification worker
        ↓
Email provider
        ↓
User receives alert
```

The current implementation ends at notification.

---

# 3. User Account

A user can create an account and configure monitoring preferences.

Basic profile:

```text
user_id
name
email
phone (optional)
LinkedIn URL (optional)
GitHub URL (optional)
```

Email is the initial notification channel.

---

# 4. Job Preferences

Users should be able to configure:

```text
Role / Job Title
Role Family
Role Level
Years of Experience
Experience Tolerance
Country
State / Region
City
Remote / Hybrid / On-site
Employment / Opportunity Type
Selected Companies
```

Example:

```text
Role Family:       Software Engineer
Level:             SDE 1
Experience:        2 years
Tolerance:         ±1 year
Country:           India
State:             Karnataka
City:              Bangalore
Work Mode:         Hybrid / Remote
Opportunity Type:  Full-time
Companies:
    Microsoft
    Google
    Amazon
```

A notification should be generated only when a new job satisfies the relevant configured criteria.

---

# 5. Company Watchlist

During onboarding, the user selects companies from the supported company list.

Example:

```text
Microsoft
Google
Amazon
Adobe
Atlassian
```

The initial product supports a maximum of 50 companies overall.

Users may later add or remove companies.

---

# 6. Critical Onboarding Notification Rule

A newly registered user **must not receive notifications for jobs that already existed before the user started monitoring a company**.

Example:

```text
User starts monitoring Microsoft:
September 3, 7:00 PM

Microsoft already has:
- SDE I
- SDE II
- Software Engineer
```

These existing jobs may be shown on the dashboard if they are active and match the user's preferences.

They must **not** generate onboarding emails.

If Microsoft publishes a new matching job at 8:15 PM:

```text
New job
  ↓
Detected after monitoring began
  ↓
Matches user
  ↓
Notification sent
```

This prevents notification flooding during onboarding.

---

# 7. Per-Company Subscription Activation

Use a per-user-company subscription record:

```text
UserCompanySubscription
-----------------------
user_id
company_id
subscribed_at
active
```

This is preferable to relying only on account creation time.

If a user adds a company later:

```text
User adds Meta on September 10
        ↓
Existing Meta jobs
        ↓
Dashboard only
        ↓
No notification
```

A new Meta opening detected after the subscription begins can generate a notification if it matches.

---

# 8. Existing Jobs vs New Jobs

### Existing jobs

Jobs already known to JobDrop before the user's company subscription began:

- May appear on the active dashboard if they match.
- Must not generate a new-job notification for that user.

### New jobs

Jobs that qualify as new opportunities after the user's monitoring begins:

- Can appear on the dashboard.
- Can generate notifications if they are active and match.

Important timestamps:

```text
posted_at
first_seen_at
```

Where:

- `posted_at` = date supplied by the source/company.
- `first_seen_at` = when JobDrop first discovered the job.

Do not rely only on `posted_at`, because a company may publish a job before JobDrop discovers it.

The system should use JobDrop's known-job inventory plus the user's subscription activation state to prevent old openings from being treated as new.

---

# 9. Job Sources

Preferred source:

```text
Official company career portal
```

Possible permitted sources:

```text
Official/public APIs
RSS/public feeds
Permitted job-board APIs
Permitted public job pages
Other permitted sources
```

Different companies may use:

```text
Custom career portal
Greenhouse
Lever
Workday
iCIMS
SmartRecruiters
Public API
RSS/feed
HTML/JSON
```

Use source-specific adapters.

All source access must respect:

- Terms of service
- Robots policies
- Rate limits
- Authentication requirements
- Applicable laws
- Permitted API/integration usage

Do not design the system around bypassing CAPTCHAs, authentication, anti-bot systems, or access controls.

---

# 10. Source Adapter Architecture

Conceptually:

```text
interface JobSourceAdapter {

    discoverJobs()

    fetchJobDetails(jobUrl)

    normalizeJob(rawJob)

    detectChanges()
}
```

Example:

```text
                    JobSourceAdapter
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
   MicrosoftAdapter   GoogleAdapter   AmazonAdapter
          |                |                |
          v                v                v
   Microsoft Careers  Google Careers  Amazon Jobs
```

Adding a company should not require redesigning the whole ingestion system.

---

# 11. Initial Synchronization

When a source is integrated:

```text
Company Career Portal
        ↓
Fetch existing jobs
        ↓
Parse
        ↓
Normalize
        ↓
Deduplicate
        ↓
Store
```

This establishes JobDrop's known-job inventory.

Initial synchronization must not cause a mass notification of all existing openings.

---

# 12. Continuous Monitoring

After initial synchronization:

```text
Source
  ↓
Periodic fetch / event
  ↓
Compare with stored state
  ↓
Detect new / updated / removed jobs
  ↓
Update database
  ↓
Generate appropriate event
```

The system should detect:

- New jobs
- Meaningfully updated jobs
- Removed/closed jobs

The primary notification event for the initial product is a **new qualifying job opening**.

---

# 13. Near-Real-Time Monitoring

Goal:

> **Low detection latency, not a false guarantee of exact publication-time detection.**

If a permitted source provides webhooks/events, use them where appropriate.

Otherwise use polling.

Example:

```text
Company source
      ↓
Poll every 30–60 seconds
      ↓
New job detected
      ↓
Process
      ↓
Match users
      ↓
Queue notification
      ↓
Send email
```

Use wording such as:

> **Continuous / near-real-time job monitoring**

Polling intervals should respect source capabilities and limits.

Possible starting strategy:

```text
High-priority source → 30–60 sec
Normal source        → 2–5 min
Slow source          → 10–15 min
```

---

# 14. Job Normalization

Different sources may use different terminology.

Examples:

```text
Software Engineer I
Software Engineer 1
SDE I
SDE 1
Software Development Engineer I
```

These may normalize to:

```text
role_family = Software Engineer
level       = SDE 1
```

Normalize:

- Company
- Job title
- Role family
- Role level
- Location
- Country
- State/region
- City
- Work mode
- Employment type
- Opportunity type
- Experience requirements

Prefer deterministic normalization.

LLM-based classification can be used later for genuinely ambiguous cases such as role, level, location, experience, or semantic classification.

Do not use an LLM unnecessarily for basic fetching or deterministic transformations.

---

# 15. Experience Matching

Years of experience is a first-class matching criterion.

Users should be able to specify:

```text
Years of experience: 2
Tolerance: ±1 year
```

or:

```text
Years of experience: 2
Tolerance: ±2 years
```

Example with ±1:

```text
User = 2 years
Accepted = 1–3 years
Rejected = 4+ years
```

Examples:

```text
User: 2 years
Job: 1–3 years
→ MATCH
```

```text
User: 0 years
Job: 5–8 years
→ NO MATCH
```

The tolerance should be a defined user/product setting rather than an arbitrary hidden rule.

---

# 16. Required vs Preferred Experience

A job may state:

```text
3+ years required
5 years preferred
```

Do not simplify this to `3–5 years`.

Store separately:

```text
required_min = 3
preferred_min = 5
```

A user with 4 years can satisfy the required requirement even if they do not meet the preferred level.

Where possible, distinguish:

- Required minimum
- Required maximum
- Preferred minimum
- Preferred maximum
- Unknown/not specified

---

# 17. Internship and Fresher Roles

Internships must be treated as an explicit opportunity type.

Suggested values:

```text
FULL_TIME
INTERNSHIP
CONTRACT
PART_TIME
OTHER
```

Internships may have:

```text
experience requirement = 0 / not required
```

Users should explicitly choose whether they want internships.

Example:

```text
Experience = 0
Internships = YES
Full-time = YES
```

May receive:

```text
Software Engineering Intern       ✓
Graduate Software Engineer        ✓
Entry-level SWE, 0–1 years       ✓
Senior Software Engineer, 5+ yrs  ✕
```

A user with several years of experience should not automatically receive internships simply because the mathematical experience range overlaps.

Opportunity type is evaluated separately from experience.

---

# 18. Unknown Experience Requirements

If JobDrop cannot confidently determine the experience requirement:

```text
EXPERIENCE_KNOWN
EXPERIENCE_UNKNOWN
```

It must not invent an experience requirement or silently assume that missing information means `0 years`.

A future preference may allow users to choose:

```text
Only jobs with known experience requirements
```

or:

```text
Allow jobs where experience is not specified
```

---

# 19. Duplicate Job Detection

The same opening may appear on several sources.

Preferred identity:

```text
company + external_job_id
```

If no reliable external ID exists, use a canonicalized combination/hash of stable fields such as:

```text
company
title
location
canonical URL
other stable attributes
```

Deduplication must happen before matching and notification.

---

# 20. Job Lifecycle

Suggested job fields:

```text
job_id
external_job_id
company
title
normalized_role
level
location
country
state
city
work_mode
experience_min
experience_max
preferred_experience_min
preferred_experience_max
opportunity_type
employment_type
description
source
source_url
posted_at
first_seen_at
last_seen_at
last_updated_at
content_hash
status
```

Primary lifecycle states:

```text
ACTIVE
CLOSED
```

`UPDATED` is better represented as a change/event state when the job remains active.

---

# 21. Closed / Expired Jobs — Hard Rule

A job that has expired, been removed, or is otherwise no longer available must not be considered an active opportunity.

Once confirmed:

```text
status = CLOSED
```

It must not:

- Participate in new matching.
- Generate new notifications.
- Appear in active recommendations.
- Appear in active job-opening dashboard results.
- Start an application workflow.
- Be treated as active again unless genuinely reposted as a new opening.

It may remain in storage for historical records, analytics, debugging, or auditability.

---

# 22. Safe Closure Detection

A missing job does not automatically mean the job is closed.

The source may have temporarily failed or returned incomplete results.

Use multiple confirmation cycles where appropriate:

```text
Sync #1
Job missing
    ↓
POSSIBLY_CLOSED

Sync #2
Still missing
    ↓
POSSIBLY_CLOSED

Sync #3
Still missing
    ↓
CLOSED
```

A trusted explicit source signal may allow immediate closure.

Temporary source failures must never cause mass false closures.

---

# 23. Dashboard Rules

The active-job dashboard should effectively represent:

```text
status = ACTIVE
AND job matches user preferences
```

Closed jobs must not appear in the active job-opening view.

Historical records may be retained separately.

Existing jobs can be visible to newly onboarded users if active and matching, but they must not generate onboarding notifications.

---

# 24. Matching Engine

Core matching dimensions:

```text
1. Job status
2. Company
3. Role / role family
4. Role level
5. Opportunity type
6. Experience
7. Location
8. Work mode
9. Employment type
10. Other configured preferences
11. User-company subscription activation
```

Conceptually:

```text
New job
   ↓
Is ACTIVE?
   ↓ YES
Company match?
   ↓ YES
Role match?
   ↓ YES
Level match?
   ↓ YES
Opportunity type match?
   ↓ YES
Experience match?
   ↓ YES
Location match?
   ↓ YES
Work mode / employment type?
   ↓ YES
Is it eligible to notify this user?
   ↓ YES
Matching user
```

At 500 users, straightforward relational matching is sufficient.

---

# 25. User-Job State

A user-job relationship can make notification state explicit.

Suggested entity:

```text
UserJob
-------
user_id
job_id
matched_at
eligible_since
notification_sent
```

This helps with:

- Duplicate prevention
- Match history
- Notification state
- Debugging

For onboarding, existing jobs can be recorded as matched without generating notifications.

---

# 26. Notification Architecture

```text
New active job
      ↓
Normalize
      ↓
Deduplicate
      ↓
Persist
      ↓
Match eligible users
      ↓
Check user-company subscription activation
      ↓
Create notification record
      ↓
Queue
      ↓
Notification worker
      ↓
Email provider
      ↓
User
```

Suggested notification data:

```text
notification_id
user_id
job_id
type
status
created_at
queued_at
sent_at
provider_message_id
attempt_count
last_error
```

---

# 27. Notification Idempotency

Duplicate emails must be prevented.

A useful logical uniqueness rule is:

```text
(user_id, job_id, notification_type)
```

For example:

```text
User 123
Job 456
NEW_JOB
```

should have at most one logical notification.

This protects against:

- Duplicate ingestion
- Duplicate events
- Multiple matching passes
- Worker retries
- Race conditions

---

# 28. Final Job-State Check Before Email

A job can close while its notification is waiting in a queue.

Therefore:

```text
Notification Worker
        ↓
Load notification
        ↓
Load job
        ↓
Is job ACTIVE?
       /      YES  NO
      |    |
    SEND  STOP
```

If the job is closed before delivery:

```text
DO NOT SEND
```

This enforces the closed-job business rule even during race conditions.

---

# 29. Notification Worker Reliability

Support:

- Retries
- Backoff where appropriate
- Provider failure handling
- Dead-letter handling
- Delivery-status tracking
- Provider webhooks where available
- Failure recovery
- Idempotent processing

Example:

```text
Worker
  ↓
Email provider
  ↓
202 Accepted
  ↓
Worker crashes
  ↓
DB update did not complete
```

Retry logic must not create uncontrolled duplicate notifications.

Provider acceptance and final delivery should be tracked as separate concepts.

---

# 30. Notification Content

Example:

```text
New Job Match

Company: Microsoft
Role: Software Engineer
Level: SDE 1
Location: Bangalore, India
Experience: 1–3 years
Work Mode: Hybrid
Opportunity Type: Full-time

[View Job]
```

The current project ends at delivering this notification.

---

# 31. Technology Direction

A practical stack could use:

### Frontend

```text
React / Next.js
```

### Backend

One of:

```text
Java + Spring Boot
Node.js
Python
```

### Database

```text
PostgreSQL
```

PostgreSQL is the durable source of truth for:

```text
Users
Companies
User preferences
User-company subscriptions
Jobs
User-job relationships
Notifications
Delivery records
```

### Ingestion

```text
HTTP clients
API clients
HTML/JSON parsers
Browser automation only where genuinely required
Source-specific adapters
```

### Optional

```text
Redis
```

for caching, rate limiting, short-lived state, or fast lookup structures.

### Queue / event streaming

```text
Kafka
or
Simpler queue/job system
```

Kafka is optional at this scale.

### Email

A transactional provider such as:

```text
SendGrid
Amazon SES
```

---

# 32. Recommended Architecture

```text
                         JOB SOURCES
                              |
                              v
                    +--------------------+
                    | Job Ingestion      |
                    | Adapters / Parsers |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Normalization      |
                    | + Classification   |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Deduplication      |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | PostgreSQL         |
                    | Source of Truth    |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Lifecycle /        |
                    | Change Detection   |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Matching Engine    |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Notification       |
                    | Record Creation    |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Queue / Kafka      |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Notification       |
                    | Worker             |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | Email Provider     |
                    +---------+----------+
                              |
                              v
                            USER
```

For the stated scale, do not create dozens of microservices.

A clean application/API with dedicated worker processes where useful is sufficient.

---

# 33. Scale Assumptions

```text
Companies <= 50
Users     <= 500
```

Example monitoring load:

```text
50 companies
×
1 check/minute
=
3,000 checks/hour
=
72,000 checks/day
```

This is manageable if source integrations are efficient and respectful.

Not every source needs the same polling interval.

---

# 34. Free Candidate Experience

Core candidate functionality is free:

```text
✓ Account creation
✓ Company selection
✓ Job preferences
✓ Role filtering
✓ Experience filtering
✓ Internship/fresher filtering
✓ Location filtering
✓ Work-mode filtering
✓ Existing active-job discovery
✓ New-job alerts
✓ Email notifications
✓ Core matching
```

At the initial 500-user scale, candidate paywalls are unnecessary.

---

# 35. Security and Reliability

Use:

```text
HTTPS / encryption in transit
Secure authentication
Authorization checks
Password hashing
Secrets management
Input validation
Database access controls
Rate limiting where appropriate
Auditability
Data minimization
```

Do not expose sensitive user data through URLs, logs, or client-controlled identifiers.

Source ingestion must respect access restrictions and must not depend on bypassing security controls.

---

# 36. Project Plan

## Phase 1 — Foundation

Build:

```text
Repository
Backend
Frontend
PostgreSQL
Configuration
Authentication
Basic deployment setup
```

Deliverable:

> User can create an account and log in.

---

## Phase 2 — User Preferences

Implement:

```text
User profile
Company selection
Role
Role level
Experience
Experience tolerance
Internship preference
Location
Work mode
Employment type
```

Deliverable:

> User can define exactly what kinds of jobs they want.

---

## Phase 3 — Company and Source Registry

Create:

```text
Company
JobSource
UserCompanySubscription
```

Start with a small number of companies.

Deliverable:

> JobDrop knows which sources belong to which companies and which companies each user monitors.

---

## Phase 4 — First Source Adapter

Implement:

```text
Discover jobs
Fetch details
Normalize
Deduplicate
Persist
```

Deliverable:

> JobDrop reliably imports jobs from one real source.

---

## Phase 5 — Initial Synchronization

Implement:

```text
Initial source sync
Existing job import
Normalization
Deduplication
Lifecycle initialization
```

Verify:

```text
Existing jobs → stored
Existing active matching jobs → dashboard
Existing jobs → no onboarding notification
```

Deliverable:

> JobDrop has a reliable baseline job inventory.

---

## Phase 6 — Continuous Monitoring

Implement:

```text
Scheduler
Polling / permitted events
Change detection
New job detection
Updated job detection
Removed job detection
Source health
Retry handling
```

Deliverable:

> JobDrop continuously tracks source changes.

---

## Phase 7 — Lifecycle and Closure

Implement:

```text
ACTIVE
POSSIBLY_CLOSED/internal confirmation
CLOSED
```

Guarantee:

```text
CLOSED job
    ↓
No active matching
No notification
No active dashboard result
```

Deliverable:

> Stale jobs cannot enter active workflows.

---

## Phase 8 — Experience and Opportunity Classification

Implement:

```text
Experience ranges
Required vs preferred experience
Internships
Fresher / graduate roles
Full-time roles
Other opportunity types
```

Use deterministic extraction first.

Use an LLM only where semantic ambiguity genuinely requires it.

Deliverable:

> JobDrop avoids obvious experience and opportunity-type mismatches.

---

## Phase 9 — Matching Engine

Implement:

```text
Company
Role
Level
Opportunity type
Experience
Location
Work mode
Employment type
User preferences
ACTIVE status
User-company subscription activation
```

Test positive and negative cases.

Deliverable:

> JobDrop correctly identifies users eligible for each new opening.

---

## Phase 10 — Notification Pipeline

Implement:

```text
Notification record
Idempotency
Queue
Worker
Email provider
Retries
Provider status
Failure handling
Final job-status check
```

Deliverable:

> A newly detected, active, matching job produces one reliable notification for each eligible user.

---

## Phase 11 — Multi-Company Expansion

Add source adapters one by one.

For every source verify:

```text
Discovery
Parsing
Normalization
Deduplication
Lifecycle
Closure detection
Rate limits
Monitoring
```

Deliverable:

> The supported-company set grows without redesigning the system.

---

## Phase 12 — Reliability Testing

Test:

```text
Duplicate jobs
Duplicate events
Source downtime
Partial source results
Job closure
Job reopening/reposting
Worker crash
Email provider failure
Retry
User unsubscribe
User adds company
Existing jobs at onboarding
Experience mismatch
Internship matching
Unknown experience
Multiple matching users
```

Deliverable:

> The notification system remains correct under normal and failure conditions.

---

# 37. MVP Definition

The MVP should demonstrate:

```text
User creates account
        ↓
Selects companies
        ↓
Sets job preferences
        ↓
Existing jobs synchronized
        ↓
Existing active matching jobs visible
        ↓
No onboarding notification flood
        ↓
Company publishes new job
        ↓
JobDrop detects it
        ↓
Normalize
        ↓
Deduplicate
        ↓
Check ACTIVE
        ↓
Classify experience/opportunity type
        ↓
Match eligible users
        ↓
Check subscription activation
        ↓
Create notification
        ↓
Queue
        ↓
Worker
        ↓
Email provider
        ↓
User receives notification
```

---

# 38. Success Criteria

The MVP is successful if:

1. Users can create accounts.
2. Users can select companies.
3. Users can configure role and location preferences.
4. Users can configure years of experience and tolerance.
5. Internship/fresher preferences work correctly.
6. Existing jobs can be imported.
7. Existing jobs do not cause an onboarding notification flood.
8. Per-company subscription activation is respected.
9. New qualifying jobs are detected.
10. Duplicate jobs are prevented.
11. Active and closed jobs are distinguished correctly.
12. Closed jobs are excluded from matching and active dashboard results.
13. Freshers are not notified about clearly senior roles.
14. Experience ranges and tolerances work correctly.
15. Required and preferred experience are distinguished where possible.
16. Different source formats can be normalized into one job model.
17. Matching users are identified correctly.
18. Duplicate notifications are prevented.
19. Notification workers retry safely.
20. Provider failures do not silently lose notifications.
21. A job that closes before queued delivery is not emailed.
22. Temporary source failures do not incorrectly close jobs.
23. The system remains within the 50-company / 500-user envelope.
24. Candidate-facing core functionality remains free.

---

# 39. Current Product Boundary

The current implementation ends at:

```text
DETECT
  ↓
NORMALIZE
  ↓
DEDUPLICATE
  ↓
CLASSIFY
  ↓
MATCH
  ↓
NOTIFY
```

It does **not** include:

```text
Automatic application filling
Browser application sessions
LLM form-field mapping
CAPTCHA interaction
Automatic application submission
```

Those belong to a separate future application-assistance subsystem.

---

# 40. Future Extension — Separate Application Assistant

After the notification system is complete and reliable, a separate subsystem may eventually extend JobDrop:

```text
JobDrop Core
    ↓
Notification
    ↓
User approval
    ↓
Application Assistant
```

That future subsystem may use a controlled browser session, user application profile, semantic field mapping, automatic filling, user verification, and manual handling of unsupported fields or CAPTCHA.

It is deliberately outside the current project plan and should not complicate the first JobDrop implementation.

---

# 41. Product Philosophy

> **Every technology exists because the product requires it.**

Therefore:

```text
Source adapters
    → handle heterogeneous career portals

Ingestion workers
    → continuously retrieve job information

Normalization
    → convert inconsistent source data into a common model

Deduplication
    → prevent duplicate logical openings

Lifecycle detection
    → prevent stale jobs from entering active workflows

PostgreSQL
    → durable source of truth

Matching engine
    → determine which users care about a job

Queue / Kafka
    → decouple detection from notification delivery

Notification workers
    → deliver alerts reliably

LLM, if used
    → resolve genuine semantic ambiguity rather than replace deterministic logic
```

Avoid technology-driven complexity.

---

# 42. Handoff Instruction for the Next LLM

This README is the current source of truth for JobDrop through the **notification stage only**.

The next LLM receiving this README should:

1. Treat these requirements and business rules as the current baseline.
2. Review the architecture and project plan critically.
3. Identify missing requirements, contradictions, technical risks, and unnecessary complexity.
4. Improve the plan where necessary rather than blindly copying it.
5. Preserve the hard constraints of **50 supported companies and 500 registered users** unless there is a strong technical reason to recommend otherwise.
6. Keep the candidate-facing core free.
7. Keep automated application filling/submission outside the current implementation scope.
8. Ensure existing jobs do not generate notifications for newly onboarded users.
9. Ensure closed/expired jobs are excluded from active matching, notifications, and active dashboard results.
10. Treat experience matching, experience tolerance, internships, and fresher roles as first-class requirements.
11. Prefer a simple and reliable architecture over unnecessary microservices.
12. Use this plan as the starting point for the next implementation/design plan.
