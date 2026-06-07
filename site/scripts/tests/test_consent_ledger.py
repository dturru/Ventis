import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import consent_ledger
from consent_ledger import is_verified, merge_consent, load_ledger, write_ledger, upsert_consent


def test_is_verified():
    assert is_verified({"consent_method": "opt_in_verbal"})
    assert is_verified({"consent_method": "building_program"})
    assert not is_verified({"consent_method": "pending"})
    assert not is_verified({"consent_method": ""})
    assert not is_verified({})
    assert not is_verified(None)


def test_merge_consent_annotates():
    records = [{"run_key": "k1"}, {"run_key": "k2"}]
    ledger = {"k1": {"run_key": "k1", "consent_method": "opt_in_verbal", "consent_date": "2026-05-21"}}
    merge_consent(records, ledger)
    assert records[0]["consent_status"] == "verified"
    assert records[0]["consent_method"] == "opt_in_verbal"
    assert records[0]["consent_date"] == "2026-05-21"
    assert records[1]["consent_status"] == "unverified"   # no ledger row -> unverified
    assert records[1]["consent_method"] == ""


def test_ledger_roundtrip(tmp_path):
    p = tmp_path / "consent_ledger.csv"
    write_ledger({"k1": {"run_key": "k1", "run_id": "", "consent_method": "occupant_self",
                         "consent_date": "2026-06-01", "terms_version": "v1", "recorded_by": "diego",
                         "notes": "own room"}}, str(p))
    led = load_ledger(str(p), db_url="")          # force CSV
    assert led["k1"]["consent_method"] == "occupant_self"
    assert is_verified(led["k1"])


def test_load_ledger_routes_to_supabase(monkeypatch):
    seen = {}
    monkeypatch.setattr(consent_ledger, "_load_ledger_pg",
                        lambda url: (seen.update(url=url), {"k": {"consent_method": "opt_in_verbal"}})[1])
    led = load_ledger(db_url="postgresql://fake")
    assert seen["url"] == "postgresql://fake"
    assert is_verified(led["k"])


def test_upsert_consent_routes_to_supabase(monkeypatch):
    captured = {}
    monkeypatch.setattr(consent_ledger, "_upsert_pg",
                        lambda rec, url: captured.update(rec=rec, url=url))
    rec = {"run_key": "k1", "run_id": "", "consent_method": "building_program",
           "consent_date": "2026-05-21", "terms_version": "v1", "recorded_by": "cofounder", "notes": ""}
    upsert_consent(rec, db_url="postgresql://fake")
    assert captured["url"] == "postgresql://fake"
    assert captured["rec"]["consent_method"] == "building_program"


def test_upsert_consent_csv_fallback(tmp_path):
    p = tmp_path / "consent_ledger.csv"
    rec = {"run_key": "k1", "run_id": "", "consent_method": "opt_in_form",
           "consent_date": "2026-06-01", "terms_version": "v1", "recorded_by": "diego", "notes": ""}
    upsert_consent(rec, path=str(p), db_url="")   # no Supabase -> CSV
    assert is_verified(load_ledger(str(p), db_url="")["k1"])
