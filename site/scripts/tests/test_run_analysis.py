import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run_analysis import extra_stats, draft_markdown, _empty


def _rows():
    # 40 samples at 60 s, CO2 rising 900 -> 1680; RH flat 40. Warm-up trim drops the
    # first 15 min (i=0..14), keeping i=15..39 (25 pts, CO2 1200..1680, all >1000).
    rows = []
    for i in range(40):
        rows.append({
            "timestamp": f"2026-06-01 20:{i:02d}:00" if i < 60 else None,
            "co2_ppm": 900 + i * 20,
            "humidity_pct": 40,
        })
    return rows


def test_extra_stats_empty():
    assert extra_stats([]) == _empty()


def test_extra_stats_warmup_trim_and_metrics():
    s = extra_stats(_rows())
    assert s["n"] == 25                       # first 15 min trimmed
    assert s["pct_over_1000"] == 100.0        # every kept reading > 1000
    assert s["co2_median"] == 1440.0
    assert s["pct_over_1400"] == 56.0         # 14 of 25 kept readings > 1400
    assert s["rh_mean"] == 40.0
    assert s["hours_over_1000"] == 0.4        # 24-min span, all exceed


def test_extra_stats_short_run_not_over_trimmed():
    # A 3-sample run shorter than the warm-up window must not trim to nothing.
    rows = [{"timestamp": f"2026-06-01 20:0{i}:00", "co2_ppm": 800 + i, "humidity_pct": None}
            for i in range(3)]
    assert extra_stats(rows)["n"] == 3


def test_draft_markdown_fills_numbers_and_leaves_tier_todo():
    rec = {"condition": "fahey_window_1person", "date": "2026-06-01",
           "duration_h": 12.0, "n_rows": 500, "co2_mean": 1300, "co2_peak": 1650}
    md = draft_markdown(rec, extra_stats(_rows()))
    assert "fahey_window_1person" in md
    assert "1300 ppm" in md                    # auto-filled number
    assert "Evidentiary tier" in md and "TODO" in md   # judgment left to human
    assert "never" not in md.lower() or "causal" in md.lower()
