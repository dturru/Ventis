import sys, os
from datetime import datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from digest import compose_digest, send

NOW = datetime(2026, 7, 14)


def _runs():
    return [
        {"condition": "fahey_window_1person", "date": "2026-07-12", "quality_flag": "good"},
        {"condition": "little_baseline_1person", "date": "2026-07-13", "quality_flag": ""},
        {"condition": "little_baseline_1person", "date": "2026-06-01", "quality_flag": "good"},
        {"condition": "judge_baseline_2person", "date": "2026-05-01", "quality_flag": ""},
    ]


def test_new_this_week_counts_only_recent():
    d = compose_digest(_runs(), NOW, window_days=7)
    assert "New this week (2)" in d            # the two July-12/13 runs
    assert "judge_baseline_2person" not in d.split("New this week")[1].split("Needs")[0]


def test_uncategorized_lists_runs_without_flag():
    d = compose_digest(_runs(), NOW)
    assert "Needs a quality flag (2)" in d      # little_baseline (07-13) + judge


def test_thin_coverage_flags_single_run_conditions():
    d = compose_digest(_runs(), NOW)
    # fahey + judge appear once; little_baseline appears twice -> not thin
    assert "Thin coverage" in d
    seg = d.split("Thin coverage")[1]
    assert "fahey_window_1person" in seg and "judge_baseline_2person" in seg
    assert "little_baseline_1person" not in seg


def test_total_count_in_header():
    assert "4 runs total" in compose_digest(_runs(), NOW)


def test_empty_dataset_is_graceful():
    d = compose_digest([], NOW)
    assert "0 runs total" in d and "New this week (0)" in d


def test_send_noop_without_webhook():
    calls = []
    assert send("hi", webhook_url="", poster=lambda u, c: calls.append(c)) is False
    assert calls == []


def test_send_posts_when_webhook_set():
    calls = []
    assert send("hi", webhook_url="https://hook", poster=lambda u, c: calls.append((u, c))) is True
    assert calls == [("https://hook", "hi")]


def test_send_is_nonfatal_on_poster_error():
    def boom(u, c):
        raise RuntimeError("down")
    assert send("hi", webhook_url="https://hook", poster=boom) is False


def test_uncategorized_header_matches_bullets_with_count():
    # Two uncategorized runs of the SAME condition: header counts runs (2), the single
    # bullet is annotated ×2 — header and list agree (no more count/dedupe mismatch).
    runs = [
        {"condition": "fahey_window_1person", "date": "2026-07-10", "quality_flag": ""},
        {"condition": "fahey_window_1person", "date": "2026-07-11", "quality_flag": ""},
    ]
    d = compose_digest(runs, NOW)
    assert "Needs a quality flag (2)" in d
    seg = d.split("Needs a quality flag")[1]
    assert "fahey_window_1person ×2" in seg
    assert seg.count("fahey_window_1person") == 1   # one bullet, not two


def test_digest_truncated_under_discord_limit():
    from digest import MAX_CHARS
    runs = [{"condition": f"bldg{i}_baseline_1person", "date": "2026-07-13",
             "quality_flag": ""} for i in range(200)]
    d = compose_digest(runs, NOW)
    assert len(d) <= MAX_CHARS
