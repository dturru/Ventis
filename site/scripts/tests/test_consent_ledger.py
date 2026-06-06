import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from consent_ledger import is_verified, merge_consent, load_ledger, write_ledger


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
    led = load_ledger(str(p))
    assert led["k1"]["consent_method"] == "occupant_self"
    assert is_verified(led["k1"])
