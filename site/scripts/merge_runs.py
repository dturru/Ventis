"""Merge runs that the pipeline wrongly split into separate runs.

The canonical case: a logger reboot (device replug, power blip) lands as a >60 min
gap, so the legacy grouper in archive_runs.group_runs starts a "new" run with the
same label. run_id firmware fixes this going forward (the id persists across a
reboot via NVS); this helper repairs runs collected BEFORE that, or any other
split/mislabel, WITHOUT touching the read-only Sheet.

How it works: a small overlay (the Supabase `run_merges` table when SUPABASE_DB_URL
is set, else a local gitignored archive/run_merges.csv) maps each folded-in
member run_key -> the surviving canonical run_id. group_runs applies it on EVERY
sync, so the merge is durable across the hourly rebuild (editing Supabase directly
would be clobbered, since runs/run_key are recomputed from the Sheet each sync).
Structurally identical to annotate.py / consent_ledger.py.

Usage:
  python merge_runs.py --list
  python merge_runs.py --merge <run_key_a> <run_key_b> [<run_key_c> ...] [--as <run_id>] [--by diego]
  python merge_runs.py --undo <canonical_run_id>

--merge folds every listed run_key into one. The canonical id is --as if given,
else the first run_key listed. --undo removes a merge (members split back apart).
"""
import csv
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
STORE = os.path.join(ARCHIVE_DIR, "run_merges.csv")

COLS = ["member_key", "canonical_run_id", "updated_by"]


def _db_url():
    return os.environ.get("SUPABASE_DB_URL")


# --- load -------------------------------------------------------------------

def load_merges(path=STORE, db_url=None):
    """-> {member_key: canonical_run_id}. Supabase when configured, else CSV.
    db_url="" forces CSV. Non-fatal: returns {} if the store is absent/unreachable."""
    src = db_url if db_url is not None else _db_url()
    if src:
        return _load_merges_pg(src)
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["member_key"]: r["canonical_run_id"]
                for r in csv.DictReader(f)
                if r.get("member_key") and r.get("canonical_run_id")}


def _load_merges_pg(db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select member_key, canonical_run_id from run_merges")
        return {r["member_key"]: r["canonical_run_id"]
                for r in cur.fetchall() if r.get("member_key")}


# --- apply (the pipeline hook) ---------------------------------------------

def apply_merges(runs, merges):
    """Collapse a {run_key: [rows]} dict per the overlay. Each member run_key folds
    into its canonical id; folded rows get run_id=canonical so all downstream
    run_id-based logic (filenames, aggregation) stays consistent. Idempotent and
    safe when merges is empty or references unknown keys."""
    if not merges:
        return runs
    out = defaultdict(list)
    for key, rows in runs.items():
        canon = merges.get(key, key)
        if canon != key:
            for r in rows:
                r["run_id"] = canon
        out[canon].extend(rows)
    return out


# --- write ------------------------------------------------------------------

def write_merges(records, path=STORE):
    """records: {member_key: full record dict}."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for mk in sorted(records):
            w.writerow(records[mk])


def _load_records_csv(path=STORE):
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["member_key"]: r for r in csv.DictReader(f) if r.get("member_key")}


def add_merge(members, canonical=None, updated_by="", path=STORE, db_url=None):
    """Fold every run_key in `members` into one canonical run id (default: members[0])."""
    members = [m for m in members if m]
    if len(members) < 2:
        raise ValueError("merge needs at least two run_keys")
    canon = (canonical or members[0]).strip()
    recs = [{"member_key": m, "canonical_run_id": canon, "updated_by": updated_by}
            for m in members]
    src = db_url if db_url is not None else _db_url()
    if src:
        _upsert_pg(recs, src)
    else:
        store = _load_records_csv(path)
        for rec in recs:
            store[rec["member_key"]] = rec
        write_merges(store, path)
    return canon


def undo_merge(canonical, path=STORE, db_url=None):
    """Remove every member folded into `canonical` (the members split back apart)."""
    src = db_url if db_url is not None else _db_url()
    if src:
        _delete_pg(canonical, src)
        return
    store = _load_records_csv(path)
    kept = {mk: r for mk, r in store.items() if r.get("canonical_run_id") != canonical}
    write_merges(kept, path)


def _upsert_pg(recs, db_url):
    import psycopg
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        cur.executemany(
            "insert into run_merges (member_key, canonical_run_id, updated_by) "
            "values (%(member_key)s,%(canonical_run_id)s,%(updated_by)s) "
            "on conflict (member_key) do update set "
            "canonical_run_id=excluded.canonical_run_id, "
            "updated_by=excluded.updated_by, updated_at=now()", recs)
        con.commit()


def _delete_pg(canonical, db_url):
    import psycopg
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        cur.execute("delete from run_merges where canonical_run_id=%s", (canonical,))
        con.commit()


# --- CLI --------------------------------------------------------------------

def _db_runs(db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(src) as con, con.cursor(row_factory=dict_row) as cur:
            cur.execute("select run_key, condition, n_rows from runs order by start_ts")
            return cur.fetchall()
    import sqlite3
    if not os.path.exists(DB):
        return []
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "SELECT run_key, condition, n_rows FROM runs ORDER BY start")]
    con.close()
    return rows


def _arg(argv, flag, default=""):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def _merge_members(argv):
    """run_keys after --merge, up to the next --flag."""
    i = argv.index("--merge") + 1
    out = []
    while i < len(argv) and not argv[i].startswith("--"):
        out.append(argv[i]); i += 1
    return out


def main(argv):
    store = "Supabase" if _db_url() else f"CSV ({STORE})"

    if "--merge" in argv:
        members = _merge_members(argv)
        if len(members) < 2:
            print("usage: --merge <run_key_a> <run_key_b> [...] [--as <run_id>] [--by name]")
            return 1
        known = {r["run_key"] for r in _db_runs()}
        unknown = [m for m in members if known and m not in known]
        if unknown:
            print(f"warning: not currently a run_key (typo? legacy keys are exact): {unknown}")
        canon = add_merge(members, canonical=_arg(argv, "--as") or None,
                          updated_by=_arg(argv, "--by"))
        print(f"merged {members} -> {canon}  ({store})")
        print("re-run the pipeline (supabase_sync.py + build_catalog.py, or the Action) to apply.")
        return 0

    if "--undo" in argv:
        canon = _arg(argv, "--undo")
        if not canon:
            print("usage: --undo <canonical_run_id>")
            return 1
        undo_merge(canon)
        print(f"undid merge {canon} ({store}); re-run the pipeline to split them back apart.")
        return 0

    merges = load_merges()
    groups = defaultdict(list)
    for member, canon in merges.items():
        groups[canon].append(member)
    print(f"run merges ({len(groups)} group(s)) -> {store}")
    for canon in sorted(groups):
        print(f"  {canon}")
        for m in sorted(groups[canon]):
            tag = "  (canonical)" if m == canon else ""
            print(f"      <- {m}{tag}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
