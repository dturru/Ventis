import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from build_catalog import derive_auto_tags


def test_ventis_device_gets_provenance_tier_and_warmup():
    rec = {"device_id": "ventis-01", "co2_mean": 1100}
    assert derive_auto_tags(rec, "") == {"scd40-pas", "tier-descriptive", "warm-up-trim"}


def test_legacy_device_gets_no_provenance():
    # Unknown/legacy device_id is never guessed (left for the one-time MH-Z16 SQL).
    rec = {"device_id": "pi-legacy", "co2_mean": 900}
    assert "scd40-pas" not in derive_auto_tags(rec, "")


def test_causal_marker_suppresses_descriptive_default():
    rec = {"device_id": "ventis-01", "co2_mean": 1100}
    tags = derive_auto_tags(rec, "fahey-grade,window-open")
    assert "tier-descriptive" not in tags


def test_no_co2_mean_no_warmup_tag():
    rec = {"device_id": "ventis-01", "co2_mean": None}
    assert "warm-up-trim" not in derive_auto_tags(rec, "")


def test_returns_only_new_tags():
    # Already-present derived tags are not re-emitted (union stays idempotent).
    rec = {"device_id": "ventis-01", "co2_mean": 1100}
    assert derive_auto_tags(rec, "scd40-pas,tier-descriptive,warm-up-trim") == set()
