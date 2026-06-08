"""Reconcile web consent submissions to runs and upsert into the consent table.

Web opt-ins land in consent_submissions (deployment-code keyed). A run's identity
(run_key) doesn't exist at submission time, so we match a submission to its run by
CONDITION + nearest start time (the cofounder uses the same condition label for the
deployment and the run). Matched submissions are upserted into the existing `consent`
table (run_key keyed) — which build_catalog reads unchanged — and stamped reconciled.

Runs in CI after supabase_sync (runs exist) and before build_catalog. Idempotent.

Env: SUPABASE_DB_URL (Session-pooler URI). Dry-run if unset.
"""
import os
import sys
from datetime import datetime

from _env import load_env
load_env()   # pick up SUPABASE_DB_URL from a gitignored .env if present (CI's env wins)

TOLERANCE_H = 36


def _parse_ts(s):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(s)[:19], fmt)
        except (ValueError, TypeError):
            pass
    return None


def match_run(submission, runs, tolerance_h=TOLERANCE_H):
    """Run whose condition matches and start is nearest agreed_at within tolerance, else None."""
    sub_t = _parse_ts(submission.get("agreed_at"))
    cond = str(submission.get("condition") or "").strip().lower()
    if sub_t is None or not cond:
        return None
    cands = [r for r in runs if str(r.get("condition") or "").strip().lower() == cond]

    def dist(r):
        rt = _parse_ts(r.get("start"))
        return abs((rt - sub_t).total_seconds()) if rt else float("inf")

    if not cands:
        return None
    best = min(cands, key=dist)
    return best if dist(best) <= tolerance_h * 3600 else None


def plan_reconcile(submissions, runs, tolerance_h=TOLERANCE_H):
    """Pure planner -> (upserts: [consent rec dict], marks: [(submission_id, run_key)]).
    Only unreconciled submissions that match a run are included."""
    upserts, marks = [], []
    for s in submissions:
        if s.get("reconciled_run_key"):
            continue
        run = match_run(s, runs, tolerance_h)
        if not run:
            continue
        upserts.append({
            "run_key": run["run_key"],
            "run_id": run.get("run_id", ""),
            "consent_method": s.get("consent_method", ""),
            "consent_date": str(s.get("agreed_at", ""))[:10],
            "terms_version": s.get("terms_version", ""),
            "recorded_by": s.get("attested_by", ""),
            "notes": s.get("notes", ""),
        })
        marks.append((s["id"], run["run_key"]))
    return upserts, marks


def _fetch(db_url):
    """-> (submissions, runs) from Supabase."""
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select id, deployment_code, condition, consent_method, attested_by, "
                    "terms_version, to_char(agreed_at,'YYYY-MM-DD HH24:MI:SS') as agreed_at, "
                    "notes, reconciled_run_key from consent_submissions")
        subs = cur.fetchall()
        cur.execute("select run_key, run_id, condition, "
                    "to_char(start_ts,'YYYY-MM-DD HH24:MI:SS') as start from runs")
        runs = cur.fetchall()
    return subs, runs


def _apply(upserts, marks, db_url):
    import psycopg
    from consent_ledger import _upsert_pg          # reuse the proven consent upsert
    for rec in upserts:
        _upsert_pg(rec, db_url)
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        for sub_id, run_key in marks:
            cur.execute("update consent_submissions set reconciled_run_key=%s where id=%s",
                        (run_key, sub_id))
        con.commit()


def reconcile(db_url=None):
    src = db_url if db_url is not None else os.environ.get("SUPABASE_DB_URL")
    if not src:
        print("(reconcile_consent: SUPABASE_DB_URL unset — skipped)")
        return 0
    # Non-fatal by design: this is a supplementary enrichment step. A missing table
    # (DDL not run yet) or a transient DB error must never break the hourly pipeline.
    try:
        subs, runs = _fetch(src)
        upserts, marks = plan_reconcile(subs, runs)
        if upserts:
            _apply(upserts, marks, src)
        print(f"reconcile_consent: {len(upserts)} submission(s) reconciled to runs "
              f"({len(subs)} total submissions, {len(runs)} runs)")
    except Exception as e:
        print(f"(reconcile_consent: skipped, {e})")
    return 0


def main(argv):
    return reconcile()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
