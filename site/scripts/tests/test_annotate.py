import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import annotate
from annotate import is_flag_valid, merge_annotations, load_annotations, write_annotations, upsert_annotation


def test_is_flag_valid():
    assert is_flag_valid("good")
    assert is_flag_valid("caution")
    assert is_flag_valid("exclude")
    assert not is_flag_valid("")
    assert not is_flag_valid("banana")


def test_merge_annotations_annotates_records():
    records = [{"run_key": "k1"}, {"run_key": "k2"}]
    annos = {"k1": {"run_key": "k1", "note": "fan died at 2am", "quality_flag": "caution",
                    "tags": "hardware", "updated_by": "diego"}}
    merge_annotations(records, annos)
    assert records[0]["note"] == "fan died at 2am"
    assert records[0]["quality_flag"] == "caution"
    assert records[0]["tags"] == "hardware"
    assert records[1]["note"] == ""           # no annotation -> empty, not missing
    assert records[1]["quality_flag"] == ""
    assert records[1]["tags"] == ""


def test_csv_roundtrip(tmp_path):
    p = tmp_path / "annotations.csv"
    write_annotations({"k1": {"run_key": "k1", "note": "n", "quality_flag": "good",
                              "tags": "", "updated_by": "diego"}}, str(p))
    a = load_annotations(str(p), db_url="")     # force CSV
    assert a["k1"]["quality_flag"] == "good"


def test_load_annotations_routes_to_supabase(monkeypatch):
    seen = {}
    monkeypatch.setattr(annotate, "_load_annotations_pg",
                        lambda url: (seen.update(url=url), {"k": {"note": "x"}})[1])
    a = load_annotations(db_url="postgresql://fake")
    assert seen["url"] == "postgresql://fake" and a["k"]["note"] == "x"


def test_upsert_carries_override_fields(tmp_path):
    store = tmp_path / "annotations.csv"
    upsert_annotation(
        {"run_key": "k1", "note": "roommate moved in", "quality_flag": "caution",
         "tags": "occupancy-change", "occupancy": "2", "window": "open", "fan": "off",
         "updated_by": "diego"},
        path=str(store), db_url="")
    annos = load_annotations(path=str(store), db_url="")
    assert annos["k1"]["occupancy"] == "2"
    assert annos["k1"]["window"] == "open"
    assert annos["k1"]["fan"] == "off"


def test_upsert_annotation_routes_to_supabase(monkeypatch):
    cap = {}
    monkeypatch.setattr(annotate, "_upsert_pg", lambda rec, url: cap.update(rec=rec, url=url))
    rec = {"run_key": "k1", "note": "n", "quality_flag": "good", "tags": "", "updated_by": "diego"}
    upsert_annotation(rec, db_url="postgresql://fake")
    assert cap["url"] == "postgresql://fake" and cap["rec"]["quality_flag"] == "good"
