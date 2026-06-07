import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import json, sqlite3
from build_catalog import parse_label, run_record, build


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


def _fixture_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE runs (run_key TEXT, run_id TEXT, device_id TEXT, condition TEXT,
        start TEXT, end TEXT, n_rows INT, co2_mean REAL, co2_peak REAL);
      CREATE TABLE readings (run_key TEXT, run_id TEXT, timestamp TEXT,
        co2_ppm REAL, temp_c REAL, humidity_pct REAL,
        fan_duty REAL, window_state TEXT, condition TEXT);
      INSERT INTO runs VALUES ('k1','r1','ventis-01','choates_x_1person',
        '2026-06-01 21:00:00','2026-06-01 22:00:00',2,800,1100);
      INSERT INTO readings VALUES ('k1','r1','2026-06-01 21:00:00',800,22,40,0,'closed','choates_x_1person'),
                                  ('k1','r1','2026-06-01 21:30:00',1100,22,41,100,'closed','choates_x_1person');
    """)
    con.commit(); con.close()


def test_parse_label_known_building_anywhere():
    assert parse_label("1RSingle - Fahey")["building"] == "fahey"
    assert parse_label("judge_baseline_2person")["building"] == "judge"
    assert parse_label("eastwheelock_fanclosed_2person")["building"] == "eastwheelock"
    assert parse_label("mystery_x_1person")["building"] == "mystery"


def test_parse_label_occupancy_variants():
    assert parse_label("eastwheelock_fanclosed_2person")["occupancy"] == 2
    assert parse_label("eastwheelock_fan_closed_2ppl")["occupancy"] == 2
    assert parse_label("summit_bedroom_two_ppl")["occupancy"] == 2
    assert parse_label("midmass_windowfan_3person")["occupancy"] == 3
    assert parse_label("little_baseline_occupied")["occupancy"] is None


def test_build_emits_catalog_and_series(tmp_path):
    db = tmp_path / "ventis.db"; _fixture_db(str(db))
    out = tmp_path / "out"
    build(db_path=str(db), out_dir=str(out), graphs_dir=str(tmp_path), db_url="")  # force SQLite
    cat = json.load(open(out / "catalog.json"))
    assert len(cat["runs"]) == 1
    assert cat["runs"][0]["building"] == "choates"
    series = json.load(open(out / "series" / "r1.json"))
    assert len(series["co2_ppm"]) == 2
    # full raw CSV is emitted + downloadable
    csv_text = open(out / "csv" / "r1.csv").read().strip().splitlines()
    assert csv_text[0] == "timestamp,co2_ppm,temp_c,humidity_pct,fan_duty,window_state,condition"
    assert len(csv_text) == 3  # header + 2 rows
    assert cat["runs"][0]["csv"] == "r1.csv"


def test_build_reads_from_supabase_when_db_url_set(tmp_path, monkeypatch):
    # When SUPABASE_DB_URL is set, build() reads runs/readings from Postgres
    # (the SoR) via _fetch_postgres, NOT SQLite. The fetcher normalizes Postgres
    # rows to the same dict shape (start/end keys, string timestamps), so all the
    # downstream record/series/CSV logic is unchanged.
    import build_catalog as bc
    runs = [{"run_key": "k1", "run_id": "r1", "device_id": "ventis-01",
             "condition": "choates_x_1person", "start": "2026-06-01 21:00:00",
             "end": "2026-06-01 22:00:00", "n_rows": 2, "co2_mean": 800.0, "co2_peak": 1100.0}]
    readings = {"k1": [
        {"timestamp": "2026-06-01 21:00:00", "co2_ppm": 800.0, "temp_c": 22.0,
         "humidity_pct": 40.0, "fan_duty": 0.0, "window_state": "closed", "condition": "choates_x_1person"},
        {"timestamp": "2026-06-01 21:30:00", "co2_ppm": 1100.0, "temp_c": 22.0,
         "humidity_pct": 41.0, "fan_duty": 100.0, "window_state": "closed", "condition": "choates_x_1person"}]}
    seen = {}
    monkeypatch.setattr(bc, "_fetch_postgres", lambda url: (seen.setdefault("url", url), (runs, readings))[1])
    out = tmp_path / "out"
    bc.build(out_dir=str(out), graphs_dir=str(tmp_path), db_url="postgresql://fake")
    assert seen["url"] == "postgresql://fake"            # routed to Postgres
    cat = json.load(open(out / "catalog.json"))
    assert len(cat["runs"]) == 1 and cat["runs"][0]["building"] == "choates"
    assert json.load(open(out / "series" / "r1.json"))["co2_ppm"] == [800.0, 1100.0]
    assert open(out / "csv" / "r1.csv").read().strip().count("\n") == 2  # header + 2 rows
