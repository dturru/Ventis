import sys, os, csv as _csv
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from import_history import map_row, convert_files


def test_map_row_legacy_schema():
    raw = {"timestamp": "2026-06-01 01:00:00", "run": "eastwheelock_fan_closed_2ppl",
           "co2": "812", "temp_in_c": "22.5", "humidity_pct": "44"}
    r = map_row(raw, "eastwheelock_fanclosed_2person")
    assert r["condition"] == "eastwheelock_fanclosed_2person"
    assert r["co2_ppm"] == "812"
    assert r["temp_c"] == "22.5"
    assert r["device_id"] == "ventis-01"
    assert r["consent"] == "anon"
    for c in ("timestamp", "device_id", "condition", "co2_ppm", "temp_c",
              "humidity_pct", "fan_duty", "window_state", "consent"):
        assert c in r


def test_map_row_fan_on_to_duty():
    raw = {"timestamp": "t", "run": "T window fan", "co2": "700",
           "temp_in_c": "21", "humidity_pct": "40", "fan_on": "true"}
    assert map_row(raw, "midmass_windowfan_3person")["fan_duty"] == 100
    raw["fan_on"] = "false"
    assert map_row(raw, "midmass_windowfan_3person")["fan_duty"] == 0


def test_convert_files_filters_and_relabels(tmp_path):
    src = tmp_path / "ew.csv"
    src.write_text("timestamp,run,co2,temp_in_c,humidity_pct\n"
                   "2026-06-01 01:00:00,eastwheelock_fan_closed_2ppl,812,22.5,44\n"
                   "2026-06-01 01:00:30,some_unmapped_run,900,22,45\n", encoding="utf-8")
    out = tmp_path / "out.csv"
    n = convert_files([str(src)], str(out))
    rows = list(_csv.DictReader(open(out, encoding="utf-8")))
    assert n == 1
    assert rows[0]["condition"] == "eastwheelock_fanclosed_2person"
    assert rows[0]["device_id"] == "ventis-01"
