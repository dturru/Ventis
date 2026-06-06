"""Per-run consent ledger — the verifiable provenance record behind the dataset.

The telemetry `consent` column is a self-asserted flag; this ledger is the audit
record that makes consent *verifiable*: per run, HOW consent was obtained, WHEN,
under WHICH terms, and by WHOM (a founder pseudonym — never an occupant identity).

Lives at archive/consent_ledger.csv (gitignored — rides the dataset backup; graduates
to the Supabase `consent` table). De-identified by design: NO occupant names/rooms.

Usage:
  python consent_ledger.py --list                         # runs + consent status
  python consent_ledger.py --set <run_key> --method opt_in_verbal --date 2026-05-21 \
                           --terms v1-2026-06 --by diego --notes "building program"
  python consent_ledger.py --validate                     # exit 1 if any run is unverified
"""
import csv
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
LEDGER = os.path.join(ARCHIVE_DIR, "consent_ledger.csv")

LEDGER_COLS = ["run_key", "run_id", "consent_method", "consent_date",
               "terms_version", "recorded_by", "notes"]

# methods that count as a real, recorded consent basis (anything else => unverified)
VALID_METHODS = {"opt_in_verbal", "opt_in_written", "opt_in_form",
                 "occupant_self", "building_program"}


def load_ledger(path=LEDGER):
    """-> {run_key: record dict}. Empty if the file doesn't exist yet."""
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["run_key"]: r for r in csv.DictReader(f) if r.get("run_key")}


def is_verified(record):
    """A ledger record verifies consent iff it names a valid method."""
    return bool(record) and str(record.get("consent_method", "")).strip() in VALID_METHODS


def merge_consent(records, ledger):
    """Annotate catalog run records with consent_status/method/date from the ledger.
    Non-destructive: leaves the raw `consent` field; adds consent_status (verified/
    unverified), consent_method, consent_date."""
    for r in records:
        led = ledger.get(r.get("run_key"))
        if is_verified(led):
            r["consent_status"] = "verified"
            r["consent_method"] = led["consent_method"]
            r["consent_date"] = led.get("consent_date", "")
        else:
            r["consent_status"] = "unverified"
            r["consent_method"] = ""
            r["consent_date"] = ""
    return records


def _db_runs():
    if not os.path.exists(DB):
        return []
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "SELECT run_key, run_id, condition FROM runs ORDER BY start")]
    con.close()
    return rows


def write_ledger(ledger, path=LEDGER):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=LEDGER_COLS, extrasaction="ignore")
        w.writeheader()
        for rk in sorted(ledger):
            w.writerow(ledger[rk])


def seed_pending(path=LEDGER):
    """Ensure every run in the DB has a ledger row (stub 'pending' if missing)."""
    ledger = load_ledger(path)
    for run in _db_runs():
        rk = run["run_key"]
        if rk not in ledger:
            ledger[rk] = {"run_key": rk, "run_id": run.get("run_id", ""),
                          "consent_method": "pending", "consent_date": "",
                          "terms_version": "", "recorded_by": "", "notes": ""}
    write_ledger(ledger, path)
    return ledger


def _arg(argv, flag, default=""):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv):
    if "--set" in argv:
        rk = _arg(argv, "--set")
        ledger = load_ledger()
        rec = ledger.get(rk, {"run_key": rk})
        rec.update({
            "consent_method": _arg(argv, "--method", rec.get("consent_method", "")),
            "consent_date": _arg(argv, "--date", rec.get("consent_date", "")),
            "terms_version": _arg(argv, "--terms", rec.get("terms_version", "")),
            "recorded_by": _arg(argv, "--by", rec.get("recorded_by", "")),
            "notes": _arg(argv, "--notes", rec.get("notes", "")),
        })
        ledger[rk] = rec
        write_ledger(ledger)
        print(f"recorded consent for {rk}: {rec['consent_method']} ({'verified' if is_verified(rec) else 'UNVERIFIED'})")
        return 0

    ledger = seed_pending()           # ensure every run has a row
    runs = _db_runs()
    verified = [r for r in runs if is_verified(ledger.get(r["run_key"]))]
    if "--validate" in argv:
        missing = [r["run_key"] for r in runs if not is_verified(ledger.get(r["run_key"]))]
        if missing:
            print(f"UNVERIFIED consent ({len(missing)}/{len(runs)} runs):")
            for m in missing:
                print(f"  {m}")
            return 1
        print(f"all {len(runs)} runs have verified consent")
        return 0

    # default: --list
    print(f"consent ledger ({len(verified)}/{len(runs)} verified) -> {LEDGER}")
    for r in runs:
        led = ledger.get(r["run_key"], {})
        status = "verified" if is_verified(led) else "PENDING"
        print(f"  [{status:8s}] {r['condition']:38s} {led.get('consent_method','') or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
