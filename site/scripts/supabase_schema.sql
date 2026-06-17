-- Ventis system-of-record (Supabase Postgres). Mirrors the SQLite Tier-1 schema.
-- Run once in the Supabase SQL Editor.
create table if not exists readings (
  id            bigint generated always as identity primary key,
  timestamp     timestamptz,
  device_id     text,
  run_id        text,
  run_key       text,
  condition     text,
  co2_ppm       double precision,
  temp_c        double precision,
  humidity_pct  double precision,
  fan_duty      double precision,
  window_state  text,
  consent       text,
  unique (device_id, timestamp)
);
create index if not exists idx_readings_run on readings(run_key);
create index if not exists idx_readings_ts  on readings(timestamp);

create table if not exists runs (
  run_key    text primary key,
  run_id     text,
  device_id  text,
  condition  text,
  start_ts   timestamptz,
  end_ts     timestamptz,
  n_rows     integer,
  co2_mean   double precision,
  co2_peak   double precision
);

-- Consent ledger: verifiable, de-identified provenance per run (graduated from
-- the gitignored archive/consent_ledger.csv). Keyed by run, NEVER by occupant.
-- Written by consent_ledger.py --set; read by build_catalog to flag consent_status.
create table if not exists consent (
  run_key        text primary key,
  run_id         text,
  consent_method text,                 -- opt_in_verbal | opt_in_written | opt_in_form | occupant_self | building_program
  consent_date   date,
  terms_version  text,
  recorded_by    text,                 -- founder pseudonym, never an occupant
  notes          text,
  updated_at     timestamptz default now()
);

-- Raw web consent intake (occupant self-serve + cofounder-assisted). Deployment-code
-- keyed; reconciled to a run (-> the consent table) by reconcile_consent.py. No PII.
create table if not exists consent_submissions (
  id                 bigint generated always as identity primary key,
  deployment_code    text not null,
  condition          text,
  consent_method     text not null,          -- opt_in_form | opt_in_verbal
  attested_by        text,                    -- 'occupant' or founder pseudonym; never a name
  terms_version      text,
  agreed_at          timestamptz default now(),
  notes              text,
  reconciled_run_key text                     -- set once matched to a run (audit)
);
create index if not exists idx_consent_sub_code on consent_submissions(deployment_code);

-- Founder run annotations: note + quality flag per run (keyed by run_key).
-- Written by annotate.py; read by build_catalog into each run record. No PII.
create table if not exists annotations (
  run_key      text primary key,
  note         text,
  quality_flag text,                 -- good | caution | exclude (else: no flag)
  tags         text,                  -- optional, comma-separated
  occupancy    int,                   -- override: actual occupancy when label is wrong
  window       text,                  -- override: open | closed | free text (e.g. open→closed→open)
  fan          text,                  -- override: on | off
  updated_by   text,                  -- founder pseudonym, never an occupant
  updated_at   timestamptz default now()
);
-- For an EXISTING annotations table, add the override columns (run in Supabase SQL editor):
--   alter table annotations
--     add column if not exists occupancy int,
--     add column if not exists "window" text,
--     add column if not exists fan text;

-- Run merges: fold runs the grouper wrongly split (e.g. a logger reboot read as a
-- >60min gap) back into one. Each row maps a folded-in member run_key -> the
-- surviving canonical run id. Written by merge_runs.py; applied in group_runs on
-- every sync (durable across the hourly rebuild). No PII.
create table if not exists run_merges (
  member_key       text primary key,   -- a run_key/run_id to fold in
  canonical_run_id text not null,      -- the surviving run id all members collapse into
  updated_by       text,               -- founder pseudonym, never an occupant
  updated_at       timestamptz default now()
);

-- Run Launcher audit log: one row per launch attempt that started a device.
-- Surfaces overridden runs ("needs attention") and lets reconcile/backfill find
-- deferred-consent runs by canonical_label. No PII (label is building_scenario_Nperson).
create table if not exists run_launches (
  id                    bigint generated always as identity primary key,
  label                 text not null,           -- composed label sent to device + consent
  canonical_label       text not null,           -- canonical() form, for dup-guard + reconcile
  started_at            timestamptz default now(),
  stopped_at            timestamptz,
  device_last_seen_secs integer,                 -- device liveness at launch (null = unknown)
  consent_status        text not null default 'recorded',  -- recorded | deferred
  override_flags        text[] not null default '{}',      -- checkpoint ids overridden
  override_reason       text,
  launched_by           text,                    -- Cf-Access email of the operator
  nonce                 text unique,             -- idempotency key from the client
  notes                 text,                    -- composed end-of-run note (door/visitors/placement/power)
  -- End-of-run capture (operator confirms conditions when ending the run via the form).
  -- Folded into the annotations table by reconcile_run_ends.py -> read by build_catalog.
  end_window            text,                    -- open | closed | changed (final/intra-run window)
  end_occupancy         int,                     -- confirmed occupancy at end
  end_quality_flag      text,                    -- good | caution | exclude
  end_tags              text,                    -- comma-separated provenance/deviation tags
  ended_by              text,                    -- Cf-Access email of the operator who ended it
  reconciled_run_key    text                     -- set once folded into annotations (audit; idempotency)
);
create index if not exists idx_run_launches_canon on run_launches(canonical_label, started_at desc);

-- For an EXISTING run_launches table, add the end-of-run capture columns
-- (run once in the Supabase SQL editor):
--   alter table run_launches
--     add column if not exists end_window text,
--     add column if not exists end_occupancy int,
--     add column if not exists end_quality_flag text,
--     add column if not exists end_tags text,
--     add column if not exists ended_by text,
--     add column if not exists reconciled_run_key text;
