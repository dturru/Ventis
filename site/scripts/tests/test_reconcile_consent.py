import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reconcile_consent import match_run, plan_reconcile, canonical

RUNS = [
    {"run_key": "k_fahey", "run_id": "r1", "condition": "fahey_window_1person",
     "start": "2026-06-01 21:00:00"},
    {"run_key": "k_judge", "run_id": "r2", "condition": "judge_baseline_2person",
     "start": "2026-06-04 18:25:00"},
]


def test_match_run_exact_condition_nearest_time():
    sub = {"condition": "fahey_window_1person", "agreed_at": "2026-06-01 20:30:00"}
    assert match_run(sub, RUNS)["run_key"] == "k_fahey"


def test_match_run_outside_tolerance_returns_none():
    sub = {"condition": "fahey_window_1person", "agreed_at": "2026-05-01 09:00:00"}
    assert match_run(sub, RUNS, tolerance_h=36) is None


def test_match_run_no_condition_match_returns_none():
    sub = {"condition": "nonexistent_x_1person", "agreed_at": "2026-06-01 21:00:00"}
    assert match_run(sub, RUNS) is None


def test_match_run_picks_nearest_among_same_condition():
    runs = [
        {"run_key": "a", "condition": "x_y_1person", "start": "2026-06-01 08:00:00"},
        {"run_key": "b", "condition": "x_y_1person", "start": "2026-06-03 08:00:00"},
    ]
    sub = {"condition": "x_y_1person", "agreed_at": "2026-06-03 07:30:00"}
    assert match_run(sub, runs)["run_key"] == "b"


def test_plan_reconcile_builds_upserts_and_marks():
    subs = [
        {"id": 1, "deployment_code": "VEN-1", "condition": "fahey_window_1person",
         "consent_method": "opt_in_form", "attested_by": "occupant",
         "terms_version": "v1", "agreed_at": "2026-06-01 20:30:00", "notes": "",
         "reconciled_run_key": None},
        {"id": 2, "deployment_code": "VEN-2", "condition": "no_such_condition",
         "consent_method": "opt_in_form", "agreed_at": "2026-06-01 20:30:00",
         "reconciled_run_key": None},
    ]
    upserts, marks = plan_reconcile(subs, RUNS)
    assert len(upserts) == 1
    assert upserts[0]["run_key"] == "k_fahey"
    assert upserts[0]["consent_method"] == "opt_in_form"
    assert upserts[0]["consent_date"] == "2026-06-01"
    assert upserts[0]["recorded_by"] == "occupant"
    assert marks == [(1, "k_fahey")]   # only the matched submission is marked


def test_reconcile_is_nonfatal_on_db_error(monkeypatch):
    # Must NOT break the hourly pipeline if the table is missing / DB hiccups.
    import reconcile_consent as rc

    def boom(url):
        raise RuntimeError('relation "consent_submissions" does not exist')

    monkeypatch.setattr(rc, "_fetch", boom)
    assert rc.reconcile(db_url="postgresql://fake") == 0   # returns 0, no exception


def test_canonical_absorbs_number_words_separators_case():
    # The real 2026-06-10 failure: "one" vs "1", spaces vs underscores, case.
    assert canonical("Little_window_one person") == canonical("little_window_1_person")
    assert canonical("FAHEY  Window-1person") == canonical("fahey_window_1_person")


def test_canonical_singularizes_occupancy_only():
    assert canonical("ew_baseline_2people") == canonical("ew_baseline_2person")
    assert canonical("ew_baseline_persons") == canonical("ew_baseline_person")


def test_canonical_keeps_genuinely_different_labels_distinct():
    # Different occupancy / building must NEVER canonicalize to the same string.
    assert canonical("little_window_1person") != canonical("little_window_2person")
    assert canonical("little_window_1person") != canonical("choates_window_1person")


def test_match_run_links_across_formatting_and_number_words():
    runs = [{"run_key": "k_lw", "condition": "little_window_1_person",
             "start": "2026-06-10 21:00:00"}]
    sub = {"condition": "Little_window_one person", "agreed_at": "2026-06-10 20:40:00"}
    assert match_run(sub, runs)["run_key"] == "k_lw"


def test_match_run_refuses_to_link_different_occupancy():
    # 1person vs 2person within the time window must still NOT link — guardrail.
    runs = [{"run_key": "k1", "condition": "little_window_1person",
             "start": "2026-06-10 21:00:00"}]
    sub = {"condition": "little_window_2person", "agreed_at": "2026-06-10 20:40:00"}
    assert match_run(sub, runs) is None


def test_plan_reconcile_skips_already_reconciled():
    subs = [{"id": 9, "condition": "fahey_window_1person",
             "consent_method": "opt_in_form", "agreed_at": "2026-06-01 20:30:00",
             "reconciled_run_key": "k_fahey"}]
    upserts, marks = plan_reconcile(subs, RUNS)
    assert upserts == [] and marks == []
