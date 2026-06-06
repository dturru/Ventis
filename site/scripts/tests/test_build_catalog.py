import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from build_catalog import parse_label, run_record


def test_parse_label_standard():
    assert parse_label("choates_windowclosed_1person") == {
        "building": "choates", "occupancy": 1}


def test_parse_label_two_person():
    assert parse_label("mclane_acon_2person")["occupancy"] == 2


def test_parse_label_no_occupancy():
    assert parse_label("east_wheelock")["occupancy"] is None


def test_parse_label_legacy_freeform():
    # legacy labels (spaces/caps) still yield a building token, no crash
    assert parse_label("1RSingle - Fahey")["building"] != ""


def test_run_record_shape():
    run = {"run_key": "k1", "run_id": "ventis-01_100", "device_id": "ventis-01",
           "condition": "choates_windowclosed_1person", "start": "2026-06-01 21:00:00",
           "end": "2026-06-01 23:00:00", "n_rows": 240, "co2_mean": 800.0,
           "co2_peak": 1100.0}
    r = run_record(run)
    for key in ("run_id", "building", "occupancy", "date", "duration_h", "co2_peak",
                "ashrae_exceed", "consent", "chart", "csv", "series", "notes"):
        assert key in r
    assert r["building"] == "choates"
    assert r["ashrae_exceed"] is True          # peak 1100 > 1000
    assert r["date"] == "2026-06-01"
    assert abs(r["duration_h"] - 2.0) < 0.01
