#!/usr/bin/env python3
"""
Ventis standard run plotter — canonical 3-panel chart for a single condition.

SOP: Projects/Ventis/Data/Data Plotting SOP.md

Produces a stacked CO2 / Temp / RH chart with a shared TIME-OF-DAY x-axis
(HH:MM wall clock), not elapsed minutes. Overnight runs read naturally.

Usage:
    python plot_ventis_run.py --csv "Ventis.v1 Logger - telemetry.csv" --condition "1RSingle - Fahey"
    python plot_ventis_run.py --csv data.csv --all          # one chart per condition
    python plot_ventis_run.py --csv data.csv --condition "X" --subtitle "1 occupant, window closed"

Conventions (see SOP):
  - Drops rows whose condition contains 'test' / 'delete' (connectivity pings).
  - Replaces -1 readings with NaN (missing channel, not zero).
  - CO2 panel: ASHRAE 1,000 + 1,400 ppm reference lines, +/-50 ppm error band,
    light rolling-mean smoothing, fan-ON spans shaded if fan_duty present.
  - Temp panel: degF. RH panel: 60% mold line.
  - X-axis: time of day, shared. Saves <condition>.png to the output dir.
"""
import argparse, sys, re
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

VAULT_DATA = Path(r"C:\Users\turru\Documents\Diego_School_Vault\Projects\Ventis\Data")
ERR_BAND_PPM = 50          # SCD40 / sensor CO2 error band (protocol standard)
SMOOTH_WINDOW = 5          # rolling-mean samples for the display line (~2.5 min @ 30s)
ASHRAE = 1000
IMPAIR = 1400
MOLD_RH = 60

C_CO2, C_TEMP, C_RH, C_FAN = "#1565c0", "#c0392b", "#2ecc71", "#2ecc71"


def slugify(label: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", label.strip()).strip("_")
    return s or "run"


def load(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df.columns = [c.strip() for c in df.columns]
    # Normalize legacy firmware schema -> canonical (run/co2/temp_in_c/fan_on),
    # so old raw CSVs chart the same as the current telemetry schema.
    aliases = {"run": "condition", "co2": "co2_ppm", "temp_in_c": "temp_c"}
    df = df.rename(columns={k: v for k, v in aliases.items()
                            if k in df.columns and v not in df.columns})
    if "fan_duty" not in df.columns and "fan_on" in df.columns:
        df["fan_duty"] = (df["fan_on"].astype(str).str.lower()
                          .isin(["true", "1", "1.0", "yes"]).astype(int) * 100)
    # drop test / connectivity rows
    df = df[~df["condition"].astype(str).str.contains("test|delete", case=False, na=False)]
    df["ts"] = pd.to_datetime(df["timestamp"])
    for col in ("co2_ppm", "temp_c", "humidity_pct"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").replace(-1, np.nan)
    if "fan_duty" in df:
        df["fan_duty"] = pd.to_numeric(df["fan_duty"], errors="coerce").fillna(0)
    return df.sort_values("ts").reset_index(drop=True)


def shade_fan(ax, df):
    """Shade contiguous fan-ON spans on the given axis. Returns True if any shaded."""
    if "fan_duty" not in df or (df["fan_duty"] > 0).sum() == 0:
        return False
    on = (df["fan_duty"] > 0).values
    t = df["ts"].values
    start = None
    for i in range(len(df)):
        if on[i] and start is None:
            start = t[i]
        elif not on[i] and start is not None:
            ax.axvspan(start, t[i], color=C_FAN, alpha=0.12, lw=0)
            start = None
    if start is not None:
        ax.axvspan(start, t[-1], color=C_FAN, alpha=0.12, lw=0)
    return True


def plot_condition(df: pd.DataFrame, condition: str, out_dir: Path, subtitle: str = "") -> Path:
    d = df[df["condition"] == condition].copy().reset_index(drop=True)
    if len(d) < 2:
        print(f"  [skip] '{condition}': only {len(d)} rows", file=sys.stderr)
        return None

    dur_h = (d["ts"].iloc[-1] - d["ts"].iloc[0]).total_seconds() / 3600
    date_str = d["ts"].iloc[0].strftime("%Y-%m-%d")
    co2 = d["co2_ppm"]
    co2_s = co2.rolling(SMOOTH_WINDOW, center=True, min_periods=1).mean()
    tempF = d["temp_c"] * 9 / 5 + 32
    rh = d["humidity_pct"]

    fig, (a1, a2, a3) = plt.subplots(3, 1, figsize=(13, 9), sharex=True)

    # ── CO2 ──
    shaded = shade_fan(a1, d)
    a1.fill_between(d["ts"], co2_s - ERR_BAND_PPM, co2_s + ERR_BAND_PPM, color=C_CO2, alpha=0.13, lw=0)
    a1.plot(d["ts"], co2_s, color=C_CO2, lw=1.5)
    a1.axhline(ASHRAE, color="#e67e22", ls="--", lw=1, label="ASHRAE 1,000 ppm")
    a1.axhline(IMPAIR, color="#c0392b", ls="--", lw=1, label="1,400 ppm impairment")
    peak = co2.max()
    sub = f" — peak {peak:.0f} ppm" + ("" if peak >= ASHRAE else " (never crosses ASHRAE)")
    a1.set_ylabel("CO₂ (ppm)")
    a1.set_title(f"{condition} — {date_str}, {dur_h:.1f} h"
                 + (f" · {subtitle}" if subtitle else "") + sub, fontsize=12)
    if shaded:
        a1.axvspan(np.nan, np.nan, color=C_FAN, alpha=0.12, label="fan ON")
    a1.legend(loc="upper right", fontsize=9)
    a1.grid(alpha=0.25)

    # ── Temp ──
    a2.plot(d["ts"], tempF, color=C_TEMP, lw=1.2)
    a2.set_ylabel("Temp (°F)")
    a2.set_title(f"Indoor temp — mean {tempF.mean():.1f}°F", fontsize=11)
    a2.grid(alpha=0.25)

    # ── RH ──
    a3.plot(d["ts"], rh, color=C_RH, lw=1.2)
    a3.axhline(MOLD_RH, color="#555", ls=":", lw=1, label="60% mold line")
    a3.set_ylabel("RH (%)")
    a3.set_title(f"Humidity — {rh.min():.0f}–{rh.max():.0f}%", fontsize=11)
    a3.legend(loc="upper right", fontsize=9)
    a3.grid(alpha=0.25)

    # ── shared time-of-day x-axis ──
    a3.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=12))
    a3.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    crosses = d["ts"].iloc[0].date() != d["ts"].iloc[-1].date()
    a3.set_xlabel("Time of day" + ("  (run crosses midnight)" if crosses else ""))
    fig.autofmt_xdate(rotation=0, ha="center")

    plt.tight_layout()
    out = out_dir / f"{slugify(condition)}.png"
    plt.savefig(out, dpi=130)
    plt.close(fig)
    print(f"  chart -> {out}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Ventis standard 3-panel run plotter (time-of-day x-axis).")
    ap.add_argument("--csv", required=True, help="telemetry CSV path")
    ap.add_argument("--condition", help="condition label to plot")
    ap.add_argument("--all", action="store_true", help="plot every condition in the file")
    ap.add_argument("--subtitle", default="", help="optional context line for the title (e.g. occupancy)")
    ap.add_argument("--out", default=str(VAULT_DATA), help="output dir (default: vault Data/)")
    args = ap.parse_args()

    df = load(Path(args.csv))
    out_dir = Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)
    conditions = df["condition"].unique().tolist()
    print(f"Loaded {len(df)} rows | conditions: {conditions}")

    if args.all:
        for c in conditions:
            plot_condition(df, c, out_dir, args.subtitle)
    elif args.condition:
        plot_condition(df, args.condition, out_dir, args.subtitle)
    else:
        ap.error("provide --condition <label> or --all")


if __name__ == "__main__":
    main()
