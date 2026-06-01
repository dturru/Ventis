# Ventis

Smart window-ventilation device for dorm rooms. An ESP32 reads CO₂ / temperature / humidity
(SCD40), runs a control loop, and serves a phone-facing dashboard over its own WiFi AP. The
dashboard shows live air quality, trends, and a first-person AI mascot ("Dodi") that explains
what's happening and what the device is doing.

---

## Repo map

```
Ventis/
├── firmware/              ESP32 application (PlatformIO)
│   ├── src/main.cpp       sensors + control loop + web server + THE DASHBOARD (embedded)
│   ├── src/main_sim.cpp   simulation build variant
│   ├── include/           config.h, secrets.h.example  (copy to secrets.h, never commit secrets)
│   ├── platformio.ini     build config
│   └── wokwi.toml         Wokwi simulator config
├── dev/                   FRONTEND DEV HARNESS  ← do UI work here (no hardware needed)
│   ├── index.html         standalone copy of the dashboard
│   ├── serve.py           local server that mocks the device's HTTP endpoints
│   ├── mock-*.json        fake device data (data / history / insight)
│   ├── generate_mocks.py  regenerate the mock CO₂ story
│   └── README.md          dev-harness details
├── outdoor-node/          SEPARATE firmware for the outdoor sensor node (not the dashboard)
├── cad/                   hardware CAD
├── marketing/             posters, booth card
└── README.md              you are here
```

---

## `main.cpp` at a glance — what each block is

`firmware/src/main.cpp` is one file (~1,725 lines) but it's cleanly divided by
`// ── Section ──` header comments. Here's what each block is and its category:

| Lines | Section | What it does | Category |
|---|---|---|---|
| 1–18 | includes + helpers | libraries (WiFi, SCD40, SSD1306 OLED, async web server) + `toF()` | setup |
| 21–28 | **Sensors** | SCD40 / DS18B20 / OLED / web-server object declarations | sensors |
| 29–118 | **State** | global `readings` struct, mode switch, history ring buffer, insight timers | state |
| 119–177 | **Control logic** | fan decision (`evaluateFan`), duty %, **fan PWM output**, history push | control |
| 178–201 | **Google Sheets logger** | POSTs readings to the Sheets web-app for data logging | networking |
| 202–229 | **RGB LED** | CO₂-colored status LED — green / amber / red | hardware |
| 230–253 | **OLED** | draws the 128×64 status screen (CO₂, temp, fan, IP) | hardware |
| 254–466 | **/insight helpers** | builds Dodi's AI text; calls the Anthropic API (offline fallback if no key/WiFi) | backend (AI) |
| **469–1385** | **`INDEX_HTML`** | **the dashboard — HTML + CSS + JS served to phones** | **FRONTEND** |
| 1387–1537 | setupServer + auto-insight | HTTP routes: `/`, `/data`, `/history`, `/control`, `/insight`, `/log/*` | backend (API) |
| 1538–1639 | **Setup** | boot sequence: pin/PWM init, OLED, SCD40, DS18B20, **WiFi connect + AP**, start server | wifi / init |
| 1640–1725 | **Loop** | the heartbeat: read sensors → control → push history → log → redraw OLED → update LED | orchestration |

> Line numbers drift as the file is edited — jump by searching for the `// ── ` section headers
> (e.g. `// ── OLED ──`). **For UI work you only care about the one bold row (`INDEX_HTML`),** and
> even then you edit `dev/index.html`, not this file. Everything else is firmware/backend.

---

## Where the frontend lives (read this first)

This is an **embedded** project, so there is **no React app and no `src/components/` folder**.
The dashboard is a single hand-written HTML/CSS/vanilla-JS page that exists in **two places that
must be kept in sync**:

1. **`dev/index.html`** — the standalone, browser-runnable copy. **Do all UI work here.**
2. **`firmware/src/main.cpp`** — the canonical copy, embedded as a C++ string named `INDEX_HTML`
   (a `R"raw( ... )raw"` literal) that the ESP32 actually serves to phones. **Source of truth on
   the device.**

Inside `main.cpp`, the dashboard is the block from `INDEX_HTML[] PROGMEM = R"raw(` to
`</body></html>)raw";` (currently ~line 469 to ~line 1385). Within that block:

| Part | Find it by searching for |
|---|---|
| All CSS | `<style>` … `</style>` |
| HTML markup | between `</style>` and the first `<script>` |
| All JS (render, sidebar, trend chart, Dodi bubbles) | `<script>` … `</script>` |

> Search for those anchors rather than trusting line numbers — they shift as the file is edited.
> Everything **outside** that block in `main.cpp` is backend C++ (sensors, control loop, the AI
> `/insight` text generator ~line 254, and the `server.on(...)` HTTP routes ~line 1388). You do not
> need to touch any of it for UI work.

---

## Dev workflow (no hardware required)

```bash
cd dev
python serve.py
# open http://localhost:8000/?mock=1   (the ?mock=1 is required — it loads mock-*.json)
```

Edit `dev/index.html`, reload the browser, iterate. The mock server fakes every endpoint the page
calls, so the JS behaves exactly as it does on the device.

To change the demo CO₂ story (the numbers the page animates through), edit the curve functions in
`dev/generate_mocks.py`, run `python generate_mocks.py`, and reload.

### Getting your changes onto the device

There is **no build step that does this automatically.** When your UI is ready, copy the final HTML
from `dev/index.html` back into the `INDEX_HTML` block in `firmware/src/main.cpp` (between the
`R"raw(` and `)raw"` markers), then flash. Keep the two files identical. *(Automating this
round-trip is a known TODO.)*

---

## The endpoint contract (what the page talks to)

The JS in the dashboard calls these device endpoints. The dev server (`serve.py`) mocks all of them,
so you can develop against the same shapes:

| Endpoint | Method | Purpose |
|---|---|---|
| `/data` | GET | current readings (co2, tempIn, humidity, tempOut, fanOn, duty, logging state) |
| `/history` | GET | ring buffer of recent samples for the trend chart |
| `/insight` | GET / POST | the AI mascot's current text (GET) / regenerate it (POST) |
| `/control` | POST | manual override + setpoint (controller mode only) |
| `/log/start`, `/log/stop` | GET | start/stop Google-Sheets logging |

Control actions only fire from a controller session (the dashboard is opened with `?ctl=1`);
plain viewers are read-only. See `mock-data.json` / `mock-history.json` for exact field shapes.

---

## Branches & the booth fallback

- **`main`** — current dashboard + dev harness. **Branch off this.**
- **`booth-fallback`** (git tag) — the proven Technigala-booth build. If a change breaks the live
  demo, recover with `git checkout booth-fallback` and flash. It is not a branch; it is a permanent
  bookmark to the known-good commit.
- `dodi-pixel-art` — Dodi mascot sprite work.

---

## Firmware build (only when flashing real hardware)

PlatformIO project in `firmware/`. Copy `include/secrets.h.example` to `include/secrets.h` and fill
in WiFi + (optional) Anthropic API key before building. `platformio.ini` defines the board/env.
UI contributors do **not** need this — the `dev/` harness covers all dashboard work.
