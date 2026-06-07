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
