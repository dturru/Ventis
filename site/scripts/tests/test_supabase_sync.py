import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from supabase_sync import build_reading_rows, aggregate_runs


def test_build_reading_rows_normalizes_and_tags():
    raw = [
        {"timestamp": "2026-06-01 0:59:32", "device_id": "ventis-01",
         "condition": "fahey_window_1person", "co2_ppm": "812", "temp_c": "22",
         "humidity_pct": "44", "fan_duty": "0", "window_state": "open", "consent": "anon"},
    ]
    rows = build_reading_rows(raw)
    r = rows[0]
    assert r["timestamp"] == "2026-06-01 00:59:32"   # hour zero-padded (reused sqlite_sync fix)
    assert r["co2_ppm"] == 812.0
    assert r["run_key"]                               # tagged by group_runs
    assert set(r) >= {"timestamp", "device_id", "run_id", "run_key", "condition",
                      "co2_ppm", "temp_c", "humidity_pct", "fan_duty", "window_state", "consent"}


def test_build_reading_rows_skips_unparseable_timestamps():
    # Postgres timestamptz rejects ""; SQLite tolerated it. Drop junk rows with no
    # valid timestamp (observed: 6 empty-ts/empty-condition rows in the real union).
    raw = [
        {"timestamp": "2026-06-01 21:00:00", "device_id": "ventis-01",
         "condition": "fahey_window_1person", "co2_ppm": "800"},
        {"timestamp": "", "device_id": "", "condition": "", "co2_ppm": ""},          # blank junk
        {"timestamp": "not-a-date", "device_id": "ventis-01", "condition": "x"},      # unparseable
    ]
    rows = build_reading_rows(raw)
    assert len(rows) == 1
    assert all(r["timestamp"] for r in rows)
    assert rows[0]["timestamp"] == "2026-06-01 21:00:00"


def test_aggregate_runs():
    rows = [
        {"run_key": "k", "run_id": "", "device_id": "ventis-01", "condition": "fahey_window_1person",
         "timestamp": "2026-06-01 21:00:00", "co2_ppm": 800.0, "temp_c": 22.0, "humidity_pct": 40.0,
         "fan_duty": 0.0, "window_state": "open", "consent": "anon"},
        {"run_key": "k", "run_id": "", "device_id": "ventis-01", "condition": "fahey_window_1person",
         "timestamp": "2026-06-01 22:00:00", "co2_ppm": 1000.0, "temp_c": 22.0, "humidity_pct": 41.0,
         "fan_duty": 0.0, "window_state": "open", "consent": "anon"},
    ]
    runs = aggregate_runs(rows)
    assert len(runs) == 1
    r = runs[0]
    assert r["run_key"] == "k" and r["n_rows"] == 2 and r["co2_peak"] == 1000.0
    assert r["start_ts"] == "2026-06-01 21:00:00" and r["end_ts"] == "2026-06-01 22:00:00"
    assert r["co2_mean"] == 900.0
