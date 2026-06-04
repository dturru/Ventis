"""Authenticated pull of the Ventis `telemetry` tab from Google Sheets.

Keeps the dataset PRIVATE — no public CSV/JSON URL, no manual browser export.
A read-only Google service account reads the sheet directly, so you can refresh
data with one command instead of re-downloading.

Config via env vars (nothing secret is committed):
  VENTIS_SHEET_ID  the Google Sheet ID — from its URL: /d/<THIS_PART>/edit
  VENTIS_SA_JSON   path to the service-account key JSON
                   (default: <this dir>/service_account.json)
  VENTIS_TAB       worksheet/tab name (default: 'telemetry')

Used two ways:
  1. `extract_runs.py` imports `fetch_rows()` to build runs.json live.
  2. CLI — pull fresh data without a browser:
       python sheet_source.py            # print run summary (condition + rows)
       python sheet_source.py --csv out  # also write out.csv (telemetry schema)
"""
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SA = os.path.join(HERE, "service_account.json")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# telemetry schema column order (see vault: Data/Telemetry Schema.md)
COLUMNS = [
    "timestamp", "device_id", "condition", "co2_ppm",
    "temp_c", "humidity_pct", "fan_duty", "window_state", "consent",
]


def _sa_path():
    return os.environ.get("VENTIS_SA_JSON", DEFAULT_SA)


def sheet_configured():
    """True if a sheet ID and a service-account key are both available."""
    return bool(os.environ.get("VENTIS_SHEET_ID")) and os.path.exists(_sa_path())


def fetch_rows():
    """Return the telemetry tab as a list of header-keyed dict rows.

    Raises RuntimeError with an actionable message if anything's missing, so the
    caller can fall back to local CSVs cleanly.
    """
    sheet_id = os.environ.get("VENTIS_SHEET_ID")
    if not sheet_id:
        raise RuntimeError("VENTIS_SHEET_ID is not set (the /d/<ID>/edit part of the sheet URL)")
    sa = _sa_path()
    if not os.path.exists(sa):
        raise RuntimeError(f"service-account JSON not found at {sa} (set VENTIS_SA_JSON)")
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError as e:
        raise RuntimeError("missing deps — run: pip install -r requirements.txt") from e

    creds = Credentials.from_service_account_file(sa, scopes=SCOPES)
    gc = gspread.authorize(creds)
    tab = os.environ.get("VENTIS_TAB", "telemetry")
    ws = gc.open_by_key(sheet_id).worksheet(tab)
    return ws.get_all_records()  # list[dict] keyed by the header row


def _summary(rows):
    counts = {}
    for r in rows:
        c = str(r.get("condition", "")).strip() or "(blank)"
        counts[c] = counts.get(c, 0) + 1
    return counts


def main(argv):
    out_csv = None
    if "--csv" in argv:
        i = argv.index("--csv")
        out_csv = argv[i + 1] if i + 1 < len(argv) else "telemetry_live.csv"

    try:
        rows = fetch_rows()
    except RuntimeError as e:
        print(f"could not pull: {e}")
        print("\nFirst-time setup: see Data/Live Sheet Pull Setup.md in the vault.")
        return 1

    print(f"pulled {len(rows)} rows from the telemetry tab\n")
    print("run (condition)                         rows")
    print("-" * 50)
    for cond, n in sorted(_summary(rows).items(), key=lambda kv: -kv[1]):
        print(f"{cond:<40s} {n:>4d}")

    if out_csv:
        with open(out_csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {out_csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
