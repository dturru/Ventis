import sys, os
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from archive_runs import co2_stats


def _rows(values, start="2026-06-10 17:48:30", step_s=30):
    """Build reading dicts at `step_s` spacing from a list of co2 values."""
    t0 = datetime.strptime(start, "%Y-%m-%d %H:%M:%S")
    return [{"timestamp": (t0 + timedelta(seconds=i * step_s)).strftime("%Y-%m-%d %H:%M:%S"),
             "co2_ppm": v} for i, v in enumerate(values)]


def test_warmup_spike_excluded_from_mean_and_peak():
    # ~7 min of deployment artifact (~2000, like the real Little startup) then steady 900
    rows = _rows([2000] * 14 + [900] * 138)
    st = co2_stats(rows)
    assert st["co2_peak"] < 1000, st          # warm-up trim kills the startup spike
    assert 890 <= st["co2_mean"] <= 910, st   # mean reflects the real steady state


def test_brief_midrun_spike_rejected_by_rolling_mean():
    # steady 900 for 1 h with a single 2000 spike mid-run (not in the warm-up window)
    vals = [900] * 60 + [2000] + [900] * 59
    st = co2_stats(_rows(vals))
    assert st["co2_peak"] < 1100, st          # 5-min rolling mean dilutes a lone spike
    assert st["co2_peak"] >= 900


def test_sustained_high_is_captured():
    # a genuine 10-min plateau at 1500 survives the rolling mean
    vals = [900] * 60 + [1500] * 20 + [900] * 60
    st = co2_stats(_rows(vals))
    assert st["co2_peak"] >= 1400, st


def test_short_run_falls_back_to_full_series():
    # < warm-up window of data -> don't over-trim; still returns numbers
    st = co2_stats(_rows([800, 1000], step_s=60))
    assert st["co2_mean"] == 900.0
    assert st["co2_peak"] == 1000


def test_empty_and_missing_co2():
    assert co2_stats([]) == {"co2_mean": None, "co2_peak": None}
    assert co2_stats([{"timestamp": "2026-06-10 17:48:30", "co2_ppm": ""}]) == {
        "co2_mean": None, "co2_peak": None}
