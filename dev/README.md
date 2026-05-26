# Ventis dev — browser preview of the web UI

This folder lets you preview the Ventis web UI in a browser without flashing the ESP32. The `index.html` here is a copy of the `INDEX_HTML` PROGMEM string in `firmware/src/main.cpp`. The `serve.py` script is a tiny HTTP server that mocks the ESP32's endpoints (`/data`, `/history`, `/insight`, `/control`) so the JS behaves identically.

## Quick start

```bash
cd dev
python serve.py
```

Then open: <http://localhost:8000/?mock=1>

The `?mock=1` query parameter tells the JS to fetch from `/mock-*.json` files instead of the live device endpoints. Without it, the page tries to hit `/data` and `/history` (which the dev server doesn't serve as live endpoints), so always include it.

## Files

| File | Purpose |
|---|---|
| `index.html` | Standalone copy of the firmware web UI — must be kept in sync with the `INDEX_HTML` string in `firmware/src/main.cpp` |
| `serve.py` | Dev HTTP server (port 8000 by default; `python serve.py 8080` for custom port). Serves static files and fakes POST `/insight` + POST `/control` |
| `generate_mocks.py` | Regenerates the three mock JSON files. Run once, or whenever you want to tweak the demo CO2 narrative |
| `mock-data.json` | One current-readings snapshot (mirrors `GET /data`) |
| `mock-history.json` | 60-sample ring buffer with a CO2 narrative arc (baseline -> rise -> alarm -> recovery -> settle) — mirrors `GET /history` |
| `mock-insight.json` | Sample Claude API response (mirrors `POST /insight`) |

## Editing the demo CO2 story

Open `generate_mocks.py` and tweak the `co2_curve()`, `temp_curve()`, or `humidity_curve()` functions. Then:

```bash
python generate_mocks.py
```

Reload the browser to see the new story.

## Keeping `index.html` in sync with the firmware

If you edit the web UI in `firmware/src/main.cpp` (the `INDEX_HTML` PROGMEM string), copy the same HTML content into `dev/index.html` so the browser preview stays accurate. A future build-step refactor could auto-generate `index.html` from the firmware source; for now, manual sync.
