import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import merge_runs
from merge_runs import apply_merges, load_merges, add_merge, undo_merge
import archive_runs


def test_apply_merges_folds_members_into_canonical():
    runs = {
        "legacy_fahey_20260612T000000": [{"condition": "fahey", "run_id": ""}],
        "legacy_fahey_20260612T180000": [{"condition": "fahey", "run_id": ""},
                                         {"condition": "fahey", "run_id": ""}],
        "other": [{"condition": "little", "run_id": ""}],
    }
    merged = apply_merges(runs, {"legacy_fahey_20260612T180000": "legacy_fahey_20260612T000000"})
    assert set(merged) == {"legacy_fahey_20260612T000000", "other"}
    assert len(merged["legacy_fahey_20260612T000000"]) == 3   # 1 + 2 folded
    # folded rows get run_id rewritten to the canonical id
    assert all(r["run_id"] == "legacy_fahey_20260612T000000"
               for r in merged["legacy_fahey_20260612T000000"][-2:])


def test_apply_merges_empty_is_noop():
    runs = {"a": [{"x": 1}], "b": [{"x": 2}]}
    assert apply_merges(runs, {}) is runs
    assert apply_merges(runs, None) is runs


def test_apply_merges_custom_canonical_id():
    runs = {"a": [{"run_id": ""}], "b": [{"run_id": ""}]}
    merged = apply_merges(runs, {"a": "ventis-01_999", "b": "ventis-01_999"})
    assert set(merged) == {"ventis-01_999"}
    assert len(merged["ventis-01_999"]) == 2


def test_group_runs_applies_merge_overlay():
    # two same-label sessions split by a >60min gap (a reboot), folded back to one
    rows = [
        {"timestamp": "2026-06-12 00:00:00", "condition": "fahey", "co2_ppm": "800"},
        {"timestamp": "2026-06-12 00:30:00", "condition": "fahey", "co2_ppm": "900"},
        # >60 min gap (reboot) -> grouper would start a new run here
        {"timestamp": "2026-06-12 02:00:00", "condition": "fahey", "co2_ppm": "850"},
    ]
    split = archive_runs.group_runs(rows, merges={})
    assert len(split) == 2, "sanity: the gap splits without a merge"
    a, b = sorted(split)
    merged = archive_runs.group_runs(rows, merges={b: a})
    assert len(merged) == 1
    assert len(next(iter(merged.values()))) == 3


def test_csv_roundtrip_and_undo(tmp_path):
    p = str(tmp_path / "run_merges.csv")
    canon = add_merge(["keyA", "keyB", "keyC"], updated_by="diego", path=p, db_url="")
    assert canon == "keyA"                       # default canonical = first member
    m = load_merges(p, db_url="")
    assert m == {"keyA": "keyA", "keyB": "keyA", "keyC": "keyA"}
    undo_merge("keyA", path=p, db_url="")
    assert load_merges(p, db_url="") == {}


def test_add_merge_custom_canonical(tmp_path):
    p = str(tmp_path / "run_merges.csv")
    canon = add_merge(["keyA", "keyB"], canonical="ventis-01_123", path=p, db_url="")
    assert canon == "ventis-01_123"
    assert load_merges(p, db_url="") == {"keyA": "ventis-01_123", "keyB": "ventis-01_123"}


def test_add_merge_requires_two_members(tmp_path):
    p = str(tmp_path / "run_merges.csv")
    try:
        add_merge(["only_one"], path=p, db_url="")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_load_merges_routes_to_supabase(monkeypatch):
    seen = {}
    monkeypatch.setattr(merge_runs, "_load_merges_pg",
                        lambda url: (seen.update(url=url), {"k": "canon"})[1])
    m = load_merges(db_url="postgresql://fake")
    assert seen["url"] == "postgresql://fake" and m["k"] == "canon"


def test_add_merge_routes_to_supabase(monkeypatch):
    cap = {}
    monkeypatch.setattr(merge_runs, "_upsert_pg", lambda recs, url: cap.update(recs=recs, url=url))
    add_merge(["a", "b"], canonical="c", db_url="postgresql://fake")
    assert cap["url"] == "postgresql://fake"
    assert {r["member_key"] for r in cap["recs"]} == {"a", "b"}
    assert all(r["canonical_run_id"] == "c" for r in cap["recs"])
