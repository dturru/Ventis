"""Build the Data Library catalog from ventis.db: catalog.json + per-run series."""
import json, os, re, shutil, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(HERE, "archive")
DB = os.path.join(ARCHIVE_DIR, "ventis.db")
GRAPHS_DIR = os.path.join(ARCHIVE_DIR, "graphs")


def parse_label(condition: str):
    """building_condition_occupancy -> {building, occupancy}. Tolerant of legacy."""
    s = str(condition or "").strip().lower()
    toks = re.split(r"[^a-z0-9]+", s)
    toks = [t for t in toks if t]
    building = toks[0] if toks else ""
    occ = None
    for t in toks:
        m = re.match(r"(\d+)person", t)
        if m:
            occ = int(m.group(1)); break
    return {"building": building, "occupancy": occ}
