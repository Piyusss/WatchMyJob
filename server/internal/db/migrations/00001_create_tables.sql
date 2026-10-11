-- The whole schema. goose runs this once on an empty database (see
-- db.go); a later change goes in a new file (00002_...sql) rather than an
-- edit here.

-- +goose Up

create table users (
    id                    uuid primary key,
    clerk_user_id         varchar(100) not null unique,
    name                  varchar(200) not null,
    email                 varchar(320) not null,
    email_verified        boolean not null,
    notifications_paused  boolean not null,
    unsubscribe_token     varchar(64) not null unique,
    created_at            timestamptz not null
);

create table companies (
    id                 uuid primary key,
    slug               varchar(100) not null unique,
    name               varchar(200) not null,
    domain             varchar(200),
    platform           varchar(20) not null,   -- GREENHOUSE, LEVER, ASHBY or TEST
    board_id           varchar(200),           -- the company's id on that job board
    active             boolean not null,
    initial_sync_done  boolean not null,
    last_synced_at     timestamptz,
    created_at         timestamptz not null
);

create table jobs (
    id                          uuid primary key,
    company_id                  uuid not null references companies (id) on delete cascade,
    external_id                 varchar(200) not null,  -- the job's id on the board
    title                       text not null,
    location                    text,
    work_mode                   varchar(20),
    opportunity_type            varchar(20) not null,
    role_family                 text,
    level                       varchar(50),
    experience_min              integer,
    experience_max              integer,
    url                         text not null,
    posted_at                   timestamptz,
    status                      varchar(10) not null,  -- ACTIVE or CLOSED
    discovered_in_initial_sync  boolean not null,
    first_seen_at               timestamptz not null,
    updated_at                  timestamptz not null,
    unique (company_id, external_id)
);
create index jobs_company_status on jobs (company_id, status);

-- Fake openings an admin writes for a TEST company (see api/admin.go).
create table test_jobs (
    id                uuid primary key,
    company_id        uuid not null references companies (id) on delete cascade,
    title             text not null,
    role_family       text not null,
    level             varchar(50),
    work_mode         varchar(20),
    opportunity_type  varchar(20) not null,
    experience_min    integer,
    experience_max    integer,
    description       text,
    application_url   text not null,
    published_at      timestamptz,
    created_at        timestamptz not null
);

create table test_job_locations (
    test_job_id   uuid not null references test_jobs (id) on delete cascade,
    country_code  varchar(10) not null,
    country_name  varchar(100) not null,
    state_code    varchar(20),
    state_name    varchar(100),
    city_name     varchar(120)
);

create table user_preferences (
    id                uuid primary key,
    user_id           uuid not null unique references users (id) on delete cascade,
    role_family       text,
    role_level        varchar(50),
    years_experience  integer,
    tolerance_years   integer,
    effective_since   timestamptz not null,
    created_at        timestamptz not null,
    updated_at        timestamptz not null
);

create table preference_work_modes (
    preferences_id  uuid not null references user_preferences (id) on delete cascade,
    work_mode       varchar(20) not null
);

create table preference_opportunity_types (
    preferences_id    uuid not null references user_preferences (id) on delete cascade,
    opportunity_type  varchar(20) not null
);

create table preference_locations (
    preferences_id  uuid not null references user_preferences (id) on delete cascade,
    country_code    varchar(10) not null,
    country_name    varchar(100) not null,
    state_code      varchar(20),
    state_name      varchar(100),
    city_name       varchar(120)
);

create table subscriptions (
    id          uuid primary key,
    user_id     uuid not null references users (id) on delete cascade,
    company_id  uuid not null references companies (id) on delete cascade,
    created_at  timestamptz not null,
    unique (user_id, company_id)
);

create table job_states (
    id          uuid primary key,
    user_id     uuid not null references users (id) on delete cascade,
    job_id      uuid not null references jobs (id) on delete cascade,
    state       varchar(10) not null,  -- SAVED, APPLIED or DISMISSED
    updated_at  timestamptz not null,
    unique (user_id, job_id)
);

create table notifications (
    id          uuid primary key,
    user_id     uuid not null references users (id) on delete cascade,
    job_id      uuid not null references jobs (id) on delete cascade,
    status      varchar(20) not null,  -- QUEUED, PROVIDER_ACCEPTED, FAILED or SKIPPED
    attempts    integer not null,
    last_error  text,
    created_at  timestamptz not null,
    sent_at     timestamptz,
    unique (user_id, job_id)  -- nobody is ever emailed twice about the same job
);
create index notifications_status on notifications (status);
