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
