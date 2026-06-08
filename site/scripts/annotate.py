"""Founder run annotations: a note + quality flag per run (the qualitative layer
on top of the measured data). Stored in the Supabase `annotations` table when
SUPABASE_DB_URL is set (read by build_catalog into the catalog), else a local
gitignored archive/annotations.csv. Structurally identical to consent_ledger.py.

Usage:
  python annotate.py --list
  python annotate.py --set <run_key> --note "fan died ~2am" --flag caution --tags hardware --by diego
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
STORE = os.path.join(ARCHIVE_DIR, "annotations.csv")

COLS = ["run_key", "note", "quality_flag", "tags", "updated_by"]
VALID_FLAGS = {"good", "caution", "exclude"}


def _db_url():
    return os.environ.get("SUPABASE_DB_URL")


def is_flag_valid(flag):
    return str(flag or "").strip() in VALID_FLAGS


def load_annotations(path=STORE, db_url=None):
    """-> {run_key: record dict}. Supabase when configured, else CSV. db_url="" forces CSV."""
    src = db_url if db_url is not None else _db_url()
    if src:
        return _load_annotations_pg(src)
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["run_key"]: r for r in csv.DictReader(f) if r.get("run_key")}


def _load_annotations_pg(db_url):
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(db_url) as con, con.cursor(row_factory=dict_row) as cur:
        cur.execute("select run_key, note, quality_flag, tags, updated_by from annotations")
        rows = cur.fetchall()
    return {r["run_key"]: {k: ("" if v is None else v) for k, v in r.items()}
            for r in rows if r.get("run_key")}


def merge_annotations(records, annos):
    """Annotate catalog run records with note/quality_flag/tags (empty string if none)."""
    for r in records:
        a = annos.get(r.get("run_key")) or {}
        r["note"] = a.get("note", "") or ""
        flag = a.get("quality_flag", "") or ""
        r["quality_flag"] = flag if is_flag_valid(flag) else ""
        r["tags"] = a.get("tags", "") or ""
    return records


def write_annotations(annos, path=STORE):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for rk in sorted(annos):
            w.writerow(annos[rk])


def _upsert_pg(rec, db_url):
    import psycopg
    p = {c: rec.get(c, "") for c in COLS}
    with psycopg.connect(db_url) as con, con.cursor() as cur:
        cur.execute(
            "insert into annotations (run_key,note,quality_flag,tags,updated_by) "
            "values (%(run_key)s,%(note)s,%(quality_flag)s,%(tags)s,%(updated_by)s) "
            "on conflict (run_key) do update set note=excluded.note, "
            "quality_flag=excluded.quality_flag, tags=excluded.tags, "
            "updated_by=excluded.updated_by, updated_at=now()", p)
        con.commit()


def upsert_annotation(rec, path=STORE, db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        _upsert_pg(rec, src)
    else:
        annos = load_annotations(path, db_url="")
        annos[rec["run_key"]] = rec
        write_annotations(annos, path)


def _db_runs(db_url=None):
    src = db_url if db_url is not None else _db_url()
    if src:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(src) as con, con.cursor(row_factory=dict_row) as cur:
            cur.execute("select run_key, condition from runs order by start_ts")
            return cur.fetchall()
    if not os.path.exists(DB):
        return []
    con = sqlite3.connect(DB); con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT run_key, condition FROM runs ORDER BY start")]
    con.close()
    return rows


def _arg(argv, flag, default=""):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv):
    store = "Supabase" if _db_url() else f"CSV ({STORE})"
    if "--set" in argv:
        rk = _arg(argv, "--set")
        existing = load_annotations().get(rk, {})
        rec = {
            "run_key": rk,
            "note": _arg(argv, "--note", existing.get("note", "")),
            "quality_flag": _arg(argv, "--flag", existing.get("quality_flag", "")),
            "tags": _arg(argv, "--tags", existing.get("tags", "")),
            "updated_by": _arg(argv, "--by", existing.get("updated_by", "")),
        }
        upsert_annotation(rec)
        print(f"annotated {rk} -> {store}: flag={rec['quality_flag'] or '-'} "
              f"{'(invalid flag)' if rec['quality_flag'] and not is_flag_valid(rec['quality_flag']) else ''}")
        return 0

    annos = load_annotations()
    runs = _db_runs()
    print(f"annotations ({len(annos)} set) -> {store}")
    for r in runs:
        a = annos.get(r["run_key"], {})
        print(f"  [{(a.get('quality_flag') or '-'):8s}] {r['condition']:38s} {a.get('note','')[:50]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
