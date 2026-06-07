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
