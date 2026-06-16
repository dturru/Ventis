"""Per-run consent ledger — the verifiable provenance record behind the dataset.

The telemetry `consent` column is a self-asserted flag; this ledger is the audit
record that makes consent *verifiable*: per run, HOW consent was obtained, WHEN,
under WHICH terms, and by WHOM (a founder pseudonym — never an occupant identity).

De-identified by design: NO occupant names/rooms, keyed only by run.

Storage (the graduation): the Supabase `consent` table when SUPABASE_DB_URL is
set — the durable, off-laptop system of record, read by CI so the catalog shows
real consent status. Falls back to the local gitignored archive/consent_ledger.csv
for offline / dev use. Same record shape either way.

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

from _env import load_env
load_env()   # pick up SUPABASE_DB_URL from a gitignored .env if present

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
LEDGER = os.path.join(ARCHIVE_DIR, "consent_ledger.csv")

LEDGER_COLS = ["run_key", "run_id", "consent_method", "consent_date",
               "terms_version", "recorded_by", "notes"]

# methods that count as a real, recorded consent basis (anything else => unverified)
VALID_METHODS = {"opt_in_verbal", "opt_in_written", "opt_in_form",
                 "occupant_self", "building_program"}


def _db_url():
    return os.environ.get("SUPABASE_DB_URL")


# ---------------------------------------------------------------- read
def load_ledger(path=LEDGER, db_url=None):
    """-> {run_key: record dict}. Reads the Supabase `consent` table when configured,
    else the CSV. Empty if neither has rows yet. Pass db_url="" to force the CSV path."""
    src = db_url if db_url is not None else _db_url()
    if src:
        return _load_ledger_pg(src)
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["run_key"]: r for r in csv.DictReader(f) if r.get("run_key")}


def _load_ledger_pg(db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select run_key, run_id, consent_method, "
                    "to_char(consent_date,'YYYY-MM-DD') as consent_date, "
                    "terms_version, recorded_by, notes from consent")
        rows = cur.fetchall()
    return {r["run_key"]: {k: ("" if v is None else v) for k, v in r.items()}
            for r in rows if r.get("run_key")}


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


# ------------------------------------------------- run list (seed/validate)
def _db_runs(db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        return _pg_runs(src)
    if not os.path.exists(DB):
        return []
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "SELECT run_key, run_id, condition FROM runs ORDER BY start")]
    con.close()
    return rows


def _pg_runs(db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select run_key, run_id, condition from runs order by start_ts")
        return cur.fetchall()


# ---------------------------------------------------------------- write
def write_ledger(ledger, path=LEDGER):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=LEDGER_COLS, extrasaction="ignore")
        w.writeheader()
        for rk in sorted(ledger):
            w.writerow(ledger[rk])


def _upsert_pg(rec, db_url):
    import psycopg
    # consent_date is a DATE column: empty string -> NULL
    p = {c: (rec.get(c) or None) if c == "consent_date" else rec.get(c, "") for c in LEDGER_COLS}
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        cur.execute(
            "insert into consent (run_key,run_id,consent_method,consent_date,"
            "terms_version,recorded_by,notes) values (%(run_key)s,%(run_id)s,"
            "%(consent_method)s,%(consent_date)s,%(terms_version)s,%(recorded_by)s,%(notes)s) "
            "on conflict (run_key) do update set run_id=excluded.run_id, "
            "consent_method=excluded.consent_method, consent_date=excluded.consent_date, "
            "terms_version=excluded.terms_version, recorded_by=excluded.recorded_by, "
            "notes=excluded.notes, updated_at=now()", p)
        con.commit()


def upsert_consent(rec, path=LEDGER, db_url=None):
    """Record one consent entry into the active store (Supabase if configured, else CSV)."""
    src = db_url if db_url is not None else _db_url()
    if src:
        _upsert_pg(rec, src)
    else:
        ledger = load_ledger(path, db_url="")
        ledger[rec["run_key"]] = rec
        write_ledger(ledger, path)


def seed_pending(path=LEDGER, db_url=None):
    """Ensure every run in the store has a ledger row (stub 'pending' if missing)."""
    src = db_url if db_url is not None else _db_url()
    ledger = load_ledger(path, db_url=src)
    for run in _db_runs(db_url=src):
        rk = run["run_key"]
        if rk not in ledger:
            stub = {"run_key": rk, "run_id": run.get("run_id", ""),
                    "consent_method": "pending", "consent_date": "",
                    "terms_version": "", "recorded_by": "", "notes": ""}
            ledger[rk] = stub
            if src:
                _upsert_pg(stub, src)
    if not src:
        write_ledger(ledger, path)
    return ledger


def _arg(argv, flag, default=""):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv):
    store = "Supabase" if _db_url() else f"CSV ({LEDGER})"
    if "--set" in argv:
        rk = _arg(argv, "--set")
        existing = load_ledger().get(rk, {})
        rec = {
            "run_key": rk,
            "run_id": existing.get("run_id", ""),
            "consent_method": _arg(argv, "--method", existing.get("consent_method", "")),
            "consent_date": _arg(argv, "--date", existing.get("consent_date", "")),
            "terms_version": _arg(argv, "--terms", existing.get("terms_version", "")),
            "recorded_by": _arg(argv, "--by", existing.get("recorded_by", "")),
            "notes": _arg(argv, "--notes", existing.get("notes", "")),
        }
        upsert_consent(rec)
        print(f"recorded consent for {rk} -> {store}: {rec['consent_method']} "
              f"({'verified' if is_verified(rec) else 'UNVERIFIED'})")
        return 0

    ledger = seed_pending()           # ensure every run has a row
    runs = _db_runs()
    verified = [r for r in runs if is_verified(ledger.get(r["run_key"]))]
    if "--validate" in argv:
        missing = [r["run_key"] for r in runs if not is_verified(ledger.get(r["run_key"]))]
        if missing:
            print(f"UNVERIFIED consent ({len(missing)}/{len(runs)} runs) [{store}]:")
            for m in missing:
                print(f"  {m}")
            return 1
        print(f"all {len(runs)} runs have verified consent [{store}]")
        return 0

    # default: --list
    print(f"consent ledger ({len(verified)}/{len(runs)} verified) -> {store}")
    for r in runs:
        led = ledger.get(r["run_key"], {})
        status = "verified" if is_verified(led) else "PENDING"
        print(f"  [{status:8s}] {r['condition']:38s} {led.get('consent_method','') or '-'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
