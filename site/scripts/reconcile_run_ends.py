"""Reconcile end-of-run captures (run_launches) to runs and upsert into annotations.

When an operator ends a run from the central form, the Run Launcher records their
end-of-run capture on the run_launches row (stopped_at + end_* fields). But the
run's identity (run_key) doesn't exist yet — the catalog groups the run later. So we
match a stopped launch to its run by canonical label + nearest end time (same trick
as reconcile_consent), then upsert the capture into the annotations table (run_key
keyed), which build_catalog reads unchanged. This is the automatic "categorize" step
of the end-of-run SOP.

Idempotent: each launch is reconciled once (stamped reconciled_run_key) and skipped
thereafter, so later builds never clobber a manual annotate.py edit.

Runs in CI after supabase_sync (runs exist) and before build_catalog. Dry-run if
SUPABASE_DB_URL is unset.
"""
import os
import sys

from _discord import post as _post_discord
from _env import load_env
load_env()   # pick up SUPABASE_DB_URL from a gitignored .env if present (CI's env wins)

# Reuse the proven canonical() + timestamp parser so TS, consent, and this all agree.
from reconcile_consent import canonical, _parse_ts

TOLERANCE_H = 36


def match_run(launch, runs, tolerance_h=TOLERANCE_H):
    """Run whose condition matches the launch's canonical_label and whose end (else
    start) is nearest the stop time, within tolerance. Else None."""
    stop_t = _parse_ts(launch.get("stopped_at"))
    cond = canonical(launch.get("canonical_label"))
    if stop_t is None or not cond:
        return None
    cands = [r for r in runs if canonical(r.get("condition")) == cond]
    if not cands:
        return None

    def dist(r):
        rt = _parse_ts(r.get("end") or r.get("start"))
        return abs((rt - stop_t).total_seconds()) if rt else float("inf")

    best = min(cands, key=dist)
    return best if dist(best) <= tolerance_h * 3600 else None


def plan_reconcile(launches, runs, tolerance_h=TOLERANCE_H):
    """Pure planner -> (upserts: [annotation rec dict], marks: [(launch_id, run_key)]).
    Only unreconciled launches that carry a capture AND match a run are included."""
    upserts, marks = [], []
    for L in launches:
        if L.get("reconciled_run_key"):
            continue
        if not (L.get("end_quality_flag") or L.get("end_window") or L.get("end_tags")):
            continue  # stopped launch with no end-of-run capture (e.g. bare stop)
        run = match_run(L, runs, tolerance_h)
        if not run:
            continue
        upserts.append({
            "run_key": run["run_key"],
            "note": L.get("notes", "") or "",
            "quality_flag": L.get("end_quality_flag", "") or "",
            "tags": L.get("end_tags", "") or "",
            "occupancy": L.get("end_occupancy"),
            "window": L.get("end_window", "") or "",
            "fan": "",
            "updated_by": (L.get("ended_by") or "run-launcher"),
        })
        marks.append((L["id"], run["run_key"]))
    return upserts, marks


def notifications_for(marks, runs):
    """Pure: -> list of human labels (run condition) for the runs just reconciled.
    Used to build one 'run documented' Discord ping per newly-categorized run."""
    cond = {r.get("run_key"): (r.get("condition") or r.get("run_key")) for r in runs}
    return [cond.get(rk, rk) for (_launch_id, rk) in marks]


def notify_documented(labels, webhook_url=None, poster=_post_discord):
    """Ping the Discord webhook once per reconciled run. SILENT no-op when the webhook
    is unset (inert until configured). Non-fatal: a webhook outage must never break the
    hourly pipeline, so every failure is swallowed. Returns the number of pings sent."""
    url = webhook_url if webhook_url is not None else os.environ.get("DISCORD_WEBHOOK_URL")
    if not url or not labels:
        return 0
    sent = 0
    for label in labels:
        try:
            poster(url, f"\U0001F4CA Run documented: `{label}`")
            sent += 1
        except Exception as e:
            print(f"(notify_documented: skipped `{label}`, {e})")
    return sent


def _fetch(db_url):
    """-> (stopped launches, runs) from Supabase."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "select id, canonical_label, "
            "to_char(stopped_at,'YYYY-MM-DD HH24:MI:SS') as stopped_at, "
            "notes, end_window, end_occupancy, end_quality_flag, end_tags, ended_by, "
            "reconciled_run_key from run_launches where stopped_at is not null")
        launches = cur.fetchall()
        cur.execute(
            "select run_key, condition, "
            "to_char(start_ts,'YYYY-MM-DD HH24:MI:SS') as start, "
            "to_char(end_ts,'YYYY-MM-DD HH24:MI:SS') as end from runs")
        runs = cur.fetchall()
    return launches, runs


def _apply(upserts, marks, db_url):
    import psycopg
    from annotate import _upsert_pg          # reuse the proven annotations upsert
    for rec in upserts:
        _upsert_pg(rec, db_url)
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        for launch_id, run_key in marks:
            cur.execute("update run_launches set reconciled_run_key=%s where id=%s",
                        (run_key, launch_id))
        con.commit()


def reconcile(db_url=None):
    src = db_url if db_url is not None else os.environ.get("SUPABASE_DB_URL")
    if not src:
        print("(reconcile_run_ends: SUPABASE_DB_URL unset — skipped)")
        return 0
    # Non-fatal by design: a missing column (DDL not run yet) or a transient DB error
    # must never break the hourly pipeline.
    try:
        launches, runs = _fetch(src)
        upserts, marks = plan_reconcile(launches, runs)
        if upserts:
            _apply(upserts, marks, src)
            # Ping AFTER a successful apply so we only announce runs actually written.
            notify_documented(notifications_for(marks, runs))
        print(f"reconcile_run_ends: {len(upserts)} end-capture(s) reconciled to runs "
              f"({len(launches)} stopped launches, {len(runs)} runs)")
    except Exception as e:
        print(f"(reconcile_run_ends: skipped, {e})")
    return 0


def main(argv):
    return reconcile()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
