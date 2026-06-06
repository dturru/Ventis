import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from build_catalog import parse_label


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
