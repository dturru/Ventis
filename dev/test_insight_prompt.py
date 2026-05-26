#!/usr/bin/env python3
"""
Offline prompt-tuning harness for Ventis /insight.

Mirrors the request the ESP32 firmware sends in firmware/src/main.cpp:callAnthropic().
Iterate the system prompt here (seconds per iteration) instead of via flash-and-test
(minutes per iteration). Once a version reads well across all scenarios, paste it
back into main.cpp's callAnthropic() and re-flash once.

USAGE:
    pip install anthropic
    python dev/test_insight_prompt.py
    python dev/test_insight_prompt.py rising_co2          # run one scenario
    python dev/test_insight_prompt.py rising_co2 alarm    # run multiple

API key resolution order:
    1. $env:ANTHROPIC_API_KEY  (PowerShell) / export ANTHROPIC_API_KEY  (bash)
    2. #define ANTHROPIC_API_KEY in firmware/include/secrets.h  (read-only, never printed)
"""

import os
import re
import sys
import time
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("Install the SDK first: pip install anthropic", file=sys.stderr)
    sys.exit(1)


# ─── KEEP IN SYNC WITH firmware/src/main.cpp:callAnthropic() ────────────────
# When this prompt reads well across every scenario, paste it back into the
# C++ string literal in callAnthropic(). That is the lock-in step.

SYSTEM_PROMPT = (
    "You are Ventis, a smart indoor air-quality sensor in a Dartmouth dorm room. "
    "Given the room's recent sensor data, write a brief observational note (1-2 short sentences) "
    "the resident would read on their phone. Narrate what the room and the system are doing right now. "
    "Cite specific numbers from the input (CO2 ppm, temp, fan state). "
    "Conversational tone, like a smart roommate noting the state of things — not a consumer app handing out advice. "
    "No emoji, no greeting, no bullet list. Stay under 200 characters.\n"
    "\n"
    "Rules:\n"
    "- If CO2 is under 800 ppm and nothing else is notable, just confirm the air is healthy in ONE short sentence. "
    "Do NOT suggest opening windows or taking action when there is no problem.\n"
    "- Only use trend words ('rising', 'climbing', 'falling') when the input explicitly states a direction. Never invent a trend.\n"
    "- When the fan is on, name the reason from the input (CO2, COOLING, HUMIDITY). Don't guess a reason that isn't there.\n"
    "- Lead with the most striking fact (e.g., CO2 hit a new high, fan ramped to 100%, temperature crossed the cooling threshold)."
)

MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 160


# ─── Scenarios — mirror buildInsightUserMessage() output ────────────────────
# Each tuple is (label, user_message_string). The user_message_string is
# byte-identical to what the ESP32 builds at runtime.

SCENARIOS = [
    (
        "good_air",
        "Now: CO2 587 ppm, indoor 72.3F / 38% RH, outdoor 64.5F.\n"
        "CO2 last ~5 min: 542 -> 587 ppm (stable).\n"
        "Fan: OFF (auto).",
    ),
    (
        "rising_co2",
        "Now: CO2 923 ppm, indoor 73.1F / 42% RH, outdoor 65.0F.\n"
        "CO2 last ~5 min: 612 -> 923 ppm (rising).\n"
        "Fan: ON (auto, reason CO2, duty 50%).",
    ),
    (
        "alarm_co2",
        "Now: CO2 1340 ppm, indoor 74.5F / 47% RH, outdoor 62.8F.\n"
        "CO2 last ~5 min: 1180 -> 1340 ppm (rising).\n"
        "Fan: ON (auto, reason CO2, duty 100%).",
    ),
    (
        "cooling_mode",
        "Now: CO2 612 ppm, indoor 78.2F / 51% RH, outdoor 64.0F.\n"
        "CO2 last ~5 min: 595 -> 612 ppm (stable).\n"
        "Fan: ON (auto, reason COOLING, duty 50%).",
    ),
    (
        "fan_override_off",
        "Now: CO2 1010 ppm, indoor 73.0F / 40% RH, outdoor 60.0F.\n"
        "CO2 last ~5 min: 720 -> 1010 ppm (rising).\n"
        "Fan: OFF (manual off).",
    ),
    (
        "humidity_high",
        "Now: CO2 740 ppm, indoor 72.0F / 71% RH, outdoor 60.0F.\n"
        "CO2 last ~5 min: 720 -> 740 ppm (stable).\n"
        "Fan: ON (auto, reason HUMIDITY, duty 50%).",
    ),
]


def load_api_key() -> str:
    """Resolve API key. Never prints or logs the key value."""
    k = os.environ.get("ANTHROPIC_API_KEY")
    if k:
        return k
    secrets = Path(__file__).resolve().parent.parent / "firmware" / "include" / "secrets.h"
    if secrets.exists():
        m = re.search(r'#define\s+ANTHROPIC_API_KEY\s+"([^"]+)"', secrets.read_text())
        if m:
            return m.group(1)
    print(
        "No ANTHROPIC_API_KEY found. Either:\n"
        '  PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n'
        "  bash:        export ANTHROPIC_API_KEY=sk-ant-...\n"
        "  or add #define ANTHROPIC_API_KEY \"sk-ant-...\" to firmware/include/secrets.h",
        file=sys.stderr,
    )
    sys.exit(2)


def run_scenario(client: anthropic.Anthropic, label: str, user_message: str) -> dict:
    print(f"\n{'─' * 72}")
    print(f"  SCENARIO: {label}")
    print(f"{'─' * 72}")
    print(user_message)
    print()

    t0 = time.perf_counter()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    dt = time.perf_counter() - t0

    text = next((b.text for b in resp.content if b.type == "text"), "")
    n = len(text)

    char_flag = "" if n <= 220 else f"  ⚠ OVER 220 chars ({n})"
    print(f"OUTPUT ({n} chars, {dt:.1f}s, stop={resp.stop_reason}){char_flag}")
    print(f"  {text}")
    print(
        f"USAGE: input={resp.usage.input_tokens} output={resp.usage.output_tokens}"
        f"  cache_read={getattr(resp.usage, 'cache_read_input_tokens', 0)}"
    )
    return {"label": label, "chars": n, "latency_s": dt, "text": text}


def main() -> int:
    api_key = load_api_key()
    client = anthropic.Anthropic(api_key=api_key)

    # Optional filter — `python test_insight_prompt.py rising_co2 alarm`
    want = set(sys.argv[1:])
    scenarios = [s for s in SCENARIOS if not want or s[0] in want]
    if not scenarios:
        print(f"No scenarios match {sorted(want)}. Available: {[s[0] for s in SCENARIOS]}")
        return 3

    results = []
    for label, msg in scenarios:
        results.append(run_scenario(client, label, msg))

    # Summary table
    print(f"\n{'═' * 72}")
    print(f"  SUMMARY  (model={MODEL})")
    print(f"{'═' * 72}")
    print(f"  {'scenario':<20} {'chars':>6} {'latency':>8}  text")
    for r in results:
        flag = " " if r["chars"] <= 220 else "!"
        preview = r["text"][:50].replace("\n", " ")
        print(f"{flag} {r['label']:<20} {r['chars']:>6} {r['latency_s']:>7.1f}s  {preview}...")
    over = [r for r in results if r["chars"] > 220]
    if over:
        print(f"\n  ⚠ {len(over)} scenario(s) exceeded 220 chars — tighten the system prompt.")
    avg_latency = sum(r["latency_s"] for r in results) / len(results)
    print(f"  Average latency: {avg_latency:.1f}s")

    return 0


if __name__ == "__main__":
    sys.exit(main())
