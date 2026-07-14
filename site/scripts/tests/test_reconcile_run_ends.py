import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reconcile_run_ends import (
    match_run, plan_reconcile, notifications_for, notify_documented,
)

RUNS = [
    {"run_key": "k_fahey", "condition": "fahey_window_1person",
     "start": "2026-06-01 21:00:00", "end": "2026-06-02 09:00:00"},
    {"run_key": "k_french", "condition": "french_window_1person",
     "start": "2026-06-14 20:57:00", "end": "2026-06-17 01:00:00"},
]


def _launch(**kw):
    base = {"id": 1, "canonical_label": "fahey_window_1person",
            "stopped_at": "2026-06-02 09:05:00", "notes": "",
            "end_window": "open", "end_occupancy": 1, "end_quality_flag": "good",
            "end_tags": "scd40-pas", "ended_by": "diego", "reconciled_run_key": None}
    base.update(kw)
    return base


def test_plan_reconcile_matches_by_label_and_nearest_end():
    upserts, marks = plan_reconcile([_launch()], RUNS)
    assert len(upserts) == 1
    assert upserts[0]["run_key"] == "k_fahey"
    assert marks == [(1, "k_fahey")]


def test_plan_reconcile_skips_already_reconciled():
    upserts, marks = plan_reconcile([_launch(reconciled_run_key="k_fahey")], RUNS)
    assert upserts == [] and marks == []


def test_plan_reconcile_skips_bare_stop_without_capture():
    # A stop with no end-of-run capture (all end_* empty) must not upsert.
    bare = _launch(end_window="", end_occupancy=None, end_quality_flag="", end_tags="")
    upserts, marks = plan_reconcile([bare], RUNS)
    assert upserts == [] and marks == []


def test_notifications_for_maps_run_key_to_condition():
    marks = [(1, "k_fahey"), (2, "k_french")]
    assert notifications_for(marks, RUNS) == [
        "fahey_window_1person", "french_window_1person"]


def test_notifications_for_falls_back_to_run_key_when_unknown():
    assert notifications_for([(9, "k_missing")], RUNS) == ["k_missing"]


def test_notify_documented_noop_without_webhook():
    calls = []
    sent = notify_documented(["x_y_1person"], webhook_url="",
                             poster=lambda u, c: calls.append((u, c)))
    assert sent == 0 and calls == []


def test_notify_documented_posts_one_per_label():
    calls = []
    sent = notify_documented(["a_b_1person", "c_d_2person"],
                             webhook_url="https://hook",
                             poster=lambda u, c: calls.append((u, c)))
    assert sent == 2
    assert all(u == "https://hook" for u, _ in calls)
    assert "a_b_1person" in calls[0][1] and "c_d_2person" in calls[1][1]


def test_notify_documented_is_nonfatal_on_poster_error():
    def boom(url, content):
        raise RuntimeError("network down")

    # One label fails, the other succeeds -> no exception, count reflects successes.
    ok = []

    def flaky(url, content):
        if "bad" in content:
            raise RuntimeError("network down")
        ok.append(content)

    sent = notify_documented(["good_run_1person", "bad_run_1person"],
                             webhook_url="https://hook", poster=flaky)
    assert sent == 1 and len(ok) == 1
