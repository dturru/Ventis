"""Extended per-run analysis for the auto-generated Data Log DRAFT. Stdlib only.

build_catalog already carries co2_mean/co2_peak (from archive_runs.co2_stats, both
warm-up-trimmed). This adds the rest of the Data Analysis Protocol block — threshold
exceedance %, median, mean RH, approx hours above 1000 ppm, diurnal peak hour — and
renders a review-ready markdown draft the operator pastes into the Data Log.

By design this NEVER decides evidentiary tier or writes caveats: those are human
judgment (the cardinal rule — a run is never auto-called causal). The draft leaves
explicit TODO placeholders for them.
"""
from datetime import datetime, timedelta

ASHRAE = 1000     # ppm — ASHRAE indoor CO2 guideline
ELEVATED = 1400   # ppm — the "clearly poor" second threshold used across the Data Log


def _parse(ts):
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(ts), fmt)
        except (ValueError, TypeError):
            pass
    return None


def _num(v):
    s = str(v).strip()
    if s in ("", "None"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _empty():
    return {"n": 0, "co2_median": None, "pct_over_1000": None, "pct_over_1400": None,
            "rh_mean": None, "hours_over_1000": None, "peak_hour": None}


def extra_stats(rows, warmup_min=15):
    """The metrics beyond co2_mean/co2_peak. Warm-up-trimmed like co2_stats (drop the
    first `warmup_min` minutes; fall back to the full series on short runs)."""
    pts = []
    for r in rows:
        dt = _parse(r.get("timestamp"))
        co2 = _num(r.get("co2_ppm"))
        rh = _num(r.get("humidity_pct"))
        if dt is not None and co2 is not None:
            pts.append((dt, co2, rh))
    if not pts:
        return _empty()
    pts.sort(key=lambda p: p[0])
    kept = [p for p in pts if p[0] >= pts[0][0] + timedelta(minutes=warmup_min)]
    if len(kept) < max(2, len(pts) // 10):     # short run -> don't over-trim
        kept = pts
    co2s = sorted(c for _, c, _ in kept)
    n = len(co2s)
    mid = n // 2
    median = co2s[mid] if n % 2 else (co2s[mid - 1] + co2s[mid]) / 2
    over1000 = sum(1 for c in co2s if c > ASHRAE)
    over1400 = sum(1 for c in co2s if c > ELEVATED)
    rhs = [rh for _, _, rh in kept if rh is not None]
    span_h = (kept[-1][0] - kept[0][0]).total_seconds() / 3600
    by_hour = {}
    for dt, c, _ in kept:
        by_hour.setdefault(dt.hour, []).append(c)
    peak_hour = (max(by_hour, key=lambda h: sum(by_hour[h]) / len(by_hour[h]))
                 if by_hour else None)
    return {
        "n": n,
        "co2_median": round(median, 1),
        "pct_over_1000": round(100 * over1000 / n, 1),
        "pct_over_1400": round(100 * over1400 / n, 1),
        "rh_mean": round(sum(rhs) / len(rhs), 1) if rhs else None,
        # approx: readings are ~evenly spaced, so exceedance fraction * span ≈ hours
        "hours_over_1000": round(span_h * over1000 / n, 1) if span_h else None,
        "peak_hour": peak_hour,
    }


def draft_markdown(rec, extra):
    """Review-ready Data Log DRAFT. Numbers auto-filled; caveats + evidentiary tier
    are left as TODO because they are human judgment (never auto-promote to causal)."""
    def f(v, suf=""):
        return f"{v}{suf}" if v is not None else "—"

    return "\n".join([
        f"### {rec.get('condition', '?')} — DRAFT ({rec.get('date', '')})",
        "",
        f"- **Duration:** {f(rec.get('duration_h'), ' h')} · **rows:** {f(rec.get('n_rows'))}",
        f"- **CO₂ mean:** {f(rec.get('co2_mean'), ' ppm')} · **median:** "
        f"{f(extra.get('co2_median'), ' ppm')} · **peak (5-min roll):** {f(rec.get('co2_peak'), ' ppm')}",
        f"- **% >1000 ppm:** {f(extra.get('pct_over_1000'), '%')} · **% >1400:** "
        f"{f(extra.get('pct_over_1400'), '%')} · **~hours >1000:** {f(extra.get('hours_over_1000'), ' h')}",
        f"- **Mean RH:** {f(extra.get('rh_mean'), '%')} · **diurnal peak hour:** "
        f"{f(extra.get('peak_hour'), ':00')}",
        "",
        "- **Caveats:** _TODO — sensor ±50 ppm; note placement / window / occupancy "
        "confounds; NO fan claim unless a controlled within-run manipulation._",
        "- **Evidentiary tier:** _TODO — descriptive / internal-only by default; promote "
        "to causal (Fahey-grade) ONLY for a controlled within-run manipulation._",
    ])
