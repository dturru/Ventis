"""
Generate mock JSON responses for browser-based UI development.

Run once (or after editing the CO2 narrative below) to refresh the mock files:
    python generate_mocks.py

Outputs:
    mock-data.json     -- a single "current readings" snapshot (mirrors GET /data)
    mock-history.json  -- 60-sample ring buffer (mirrors GET /history)
    mock-insight.json  -- a sample Claude API response (mirrors POST /insight)
"""

import json
import math
from pathlib import Path

OUT_DIR = Path(__file__).parent
INTERVAL_S = 5
N_SAMPLES = 60   # 5 minutes at 5s cadence


def co2_curve(t):
    """t in seconds before now (negative). Returns ppm.

    Narrative arc designed to demo every threshold tier in 5 minutes:
      -295 to -220  : baseline ~620 ppm (HEALTHY / green)
      -220 to -145  : rising 620 -> 1000 ppm
      -145 to -95   : peak     1000 -> 1150 ppm (ALARM / red, fan auto-triggers)
      -95  to -20   : falling  1150 -> 700 ppm (fan recovering)
      -20  to   0   : settled  700 -> 660 ppm (back to normal)
    """
    if t < -220:
        return 620 + 10 * math.sin(t / 30)
    elif t < -145:
        return 620 + (t + 220) / 75 * (1000 - 620)
    elif t < -95:
        return 1000 + (t + 145) / 50 * (1150 - 1000)
    elif t < -20:
        return 1150 + (t + 95) / 75 * (700 - 1150)
    else:
        return 700 + (t + 20) / 20 * (660 - 700)


def temp_curve(t):
    """Indoor temp drifts slightly with stuffiness; °C."""
    return 22.5 + 0.4 * math.exp(-((t + 120) ** 2) / 6000)


def humidity_curve(t):
    """%RH; rises with CO2 a bit."""
    return 40.0 + 3.0 * math.exp(-((t + 120) ** 2) / 6000)


def main():
    # History: 60 samples spanning t = -295..0 in 5s steps
    samples = []
    for i in range(N_SAMPLES):
        t = -((N_SAMPLES - 1 - i) * INTERVAL_S)  # -295, -290, ..., -5, 0
        co2 = int(round(co2_curve(t)))
        samples.append({
            "t": t,
            "co2": co2,
            "tempIn": round(temp_curve(t), 1),
            "humidity": round(humidity_curve(t), 0),
            "tempOut": 20.0,
            "fanOn": co2 > 800,
        })

    history = {"interval_ms": INTERVAL_S * 1000, "samples": samples}
    (OUT_DIR / "mock-history.json").write_text(json.dumps(history, indent=2))

    # Current data = the last sample, expanded
    last = samples[-1]
    data = {
        "co2": last["co2"],
        "tempIn": last["tempIn"],
        "humidity": last["humidity"],
        "tempOut": last["tempOut"],
        "fanOn": last["fanOn"],
        "reason": "CO2" if last["fanOn"] else "---",
        "duty": 128 if last["fanOn"] else 0,
        "logEnabled": False,
        "runLabel": "unlabeled",
        "logRowCount": 0,
    }
    (OUT_DIR / "mock-data.json").write_text(json.dumps(data, indent=2))

    # Insight: a sample Claude API response (what live /insight will look like)
    insight = {
        "text": (
            "Your CO2 peaked at 1,150 ppm about two minutes ago, well above the "
            "1,000 ppm threshold. The fan kicked in automatically and brought "
            "levels back to ~700 ppm. Air quality is recovering well."
        ),
        "generated_at": "2026-05-25T23:30:00",
        "source": "live",
    }
    (OUT_DIR / "mock-insight.json").write_text(json.dumps(insight, indent=2))

    print(f"Generated 3 mock files in {OUT_DIR}/")
    print(f"  mock-data.json     ({len(data)} fields)")
    print(f"  mock-history.json  ({len(samples)} samples, CO2 {min(s['co2'] for s in samples)}-{max(s['co2'] for s in samples)} ppm)")
    print(f"  mock-insight.json  ({len(insight['text'])} chars)")


if __name__ == "__main__":
    main()
