# Durability & Device Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes. Written for a COLD START.
>
> **🔧 HARDWARE-GATED legend:** tasks marked **🔧 HARDWARE-GATED** change the ESP32 firmware and **cannot be fully verified by a cold session** — they need the physical device flashed over USB and observed. A cold agent should implement the code and run the build (`pio run`), then STOP at the verification step and hand off to Diego/cofounder for the on-device check. Tasks without the marker (the server `/api/ingest` endpoint) are fully cold-executable and TDD'd.

**Goal:** Harden the data path and the device so the dataset is durable and the device is safe to expose: (A) an authenticated server ingestion endpoint so the device can write readings straight to the SoR (removing the Google Sheet row ceiling), and (B) firmware hardening — endpoint auth, Anthropic-key protection, and the dashboard-refresh heap crash.

**Architecture:** Track A adds `POST /api/ingest` (Vercel function, mirrors the consent function: server-side `pg`, token-authenticated) that inserts reading batches into Supabase `readings`. Track B (firmware) adds a shared-secret check to the device's mutating endpoints, switches the device to **dual-write** (Sheet as today + the new `/api/ingest`) during transition, gets `/insight` behind auth, and addresses the heap crash. The Sheet stays as the cofounder's control surface; only the data path gains a direct, scalable route.

**Tech Stack:** Vercel function (Node `pg`) + vitest (Track A); ESP32 / Arduino / PlatformIO C++ (Track B); Supabase Postgres.

**Cold-start orientation — read first:**
- `site/api/consent.ts` + `site/api/_validate.ts` — the EXACT pattern Track A copies (Vercel function, `import pg from "pg"`, `ssl:{rejectUnauthorized:false}`, `./x.js` ESM import extension, server-side cred). **These gotchas already bit us once — replicate them, do not rediscover them.**
- `site/vercel.json` — the `/((?!api/).*)` rewrite already excludes `/api`; new functions need no change.
- `firmware/src/main.cpp` — the AsyncWebServer setup (`setupServer()` ~line 1463), the endpoints (`/data` GET, `/log/start|stop` GET, `/outdoor` POST, `/control` POST, `/insight` POST/GET), `logToSheets()` (~line 191, the current ingestion via `SHEETS_URL`), and the `/insight` Anthropic call (~line 457-508, uses `ANTHROPIC_API_KEY`).
- `firmware/include/config.h` + `firmware/include/secrets.h` — where `SHEETS_URL`, `ANTHROPIC_API_KEY`, Wi-Fi creds live (secrets.h is gitignored). New device secrets go here.
- `firmware/platformio.ini` — build env (`esp32dev`). Build with `pio run -e esp32dev`; flash with `pio run -e esp32dev -t upload`.

**Decisions confirmed:**
- Device ingestion is **dual-write** (Sheet + `/api/ingest`) initially — no big-bang cutover. Pruning the Sheet path comes later, after the direct path is proven on hardware.
- Endpoint auth = a **shared secret** (`X-Ventis-Token` header / `?token=`), stored in `secrets.h` on device and as a Vercel/CI env var server-side. Not per-user auth (that's the deferred "B" architecture).
- The Anthropic key stays in gitignored `secrets.h`; the fix is to (1) rotate it and (2) put `/insight` behind the shared-secret check so a softAP visitor can't burn credits.

---

## Prerequisites (Diego — manual)

- [ ] **🔴 Rotate the Anthropic API key now** (P0) in the Anthropic console; put the new value in `firmware/include/secrets.h` (`ANTHROPIC_API_KEY`). The old key was exposed via the unauthenticated `/insight`.
- [ ] Choose a device shared secret; set `VENTIS_INGEST_TOKEN` in the **Vercel** env (Track A) and the SAME value as `DEVICE_TOKEN` in `firmware/include/secrets.h` (Track B).
- [ ] Firmware tasks need the device on USB to flash + verify.

---

# Track A — Server ingestion endpoint (cold-executable, TDD)

## Task A1: Ingestion payload validator (pure, TDD)

**Files:**
- Create: `site/api/_ingest_validate.ts`
- Test: `site/api/_ingest_validate.test.ts`

- [ ] **Step 1: Write the failing tests**

`site/api/_ingest_validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateIngest } from "./_ingest_validate";

const reading = {
  device_id: "ventis-01", run_id: "ventis-01_1717000000", condition: "fahey_window_1person",
  timestamp: "2026-06-01 21:00:00", co2_ppm: 812, temp_c: 22.1, humidity_pct: 44,
  fan_duty: 0, window_state: "open", consent: "anon",
};

describe("validateIngest", () => {
  it("accepts a batch of readings", () => {
    const r = validateIngest({ readings: [reading, reading] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(2);
  });
  it("rejects a missing/empty batch", () => {
    expect(validateIngest({}).ok).toBe(false);
    expect(validateIngest({ readings: [] }).ok).toBe(false);
  });
  it("rejects a non-array readings field", () => {
    expect(validateIngest({ readings: "nope" }).ok).toBe(false);
  });
  it("caps batch size", () => {
    const big = { readings: Array(2000).fill(reading) };
    const r = validateIngest(big);
    expect(r.ok).toBe(false);   // over the per-request cap (e.g. 1000)
  });
  it("coerces numerics and drops rows with no timestamp", () => {
    const r = validateIngest({ readings: [{ ...reading, timestamp: "" }, reading] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(1);   // the empty-timestamp row is dropped
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd site && npx vitest run api/_ingest_validate.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`site/api/_ingest_validate.ts`:

```typescript
export interface Reading {
  device_id: string; run_id: string; condition: string; timestamp: string;
  co2_ppm: number | null; temp_c: number | null; humidity_pct: number | null;
  fan_duty: number | null; window_state: string; consent: string;
}
type Result = { ok: true; value: Reading[] } | { ok: false; error: string };

const MAX_BATCH = 1000;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export function validateIngest(body: any): Result {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  const raw = body.readings;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "no readings" };
  if (raw.length > MAX_BATCH) return { ok: false, error: "batch too large" };
  const value: Reading[] = [];
  for (const r of raw) {
    const ts = str(r?.timestamp, 25).trim();
    if (!ts) continue;                       // Postgres timestamptz rejects ""
    value.push({
      device_id: str(r.device_id, 40), run_id: str(r.run_id, 60),
      condition: str(r.condition, 120), timestamp: ts,
      co2_ppm: num(r.co2_ppm), temp_c: num(r.temp_c), humidity_pct: num(r.humidity_pct),
      fan_duty: num(r.fan_duty), window_state: str(r.window_state, 16), consent: str(r.consent, 16),
    });
  }
  if (value.length === 0) return { ok: false, error: "no valid readings" };
  return { ok: true, value };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd site && npx vitest run api/_ingest_validate.test.ts` → PASS (5).

- [ ] **Step 5: Commit**

```bash
git add site/api/_ingest_validate.ts site/api/_ingest_validate.test.ts
git commit -m "feat(ingest): reading-batch validator (TDD)"
```

## Task A2: The ingestion function

**Files:**
- Create: `site/api/ingest.ts`

- [ ] **Step 1: Implement (copy consent.ts's proven shape exactly)**

`site/api/ingest.ts`:

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import pg from "pg";                                  // default import (ESM)
import { validateIngest } from "./_ingest_validate.js";  // .js extension (ESM)

const { Client } = pg;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const token = req.headers["x-ventis-token"];
  if (!process.env.VENTIS_INGEST_TOKEN || token !== process.env.VENTIS_INGEST_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const v = validateIngest(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const url = process.env.SUPABASE_DB_URL;
  if (!url) return res.status(500).json({ error: "not configured" });

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const text =
      "insert into readings (timestamp,device_id,run_id,condition,co2_ppm,temp_c," +
      "humidity_pct,fan_duty,window_state,consent) values " +
      "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (device_id, timestamp) do nothing";
    for (const r of v.value) {
      await client.query(text, [r.timestamp, r.device_id, r.run_id, r.condition, r.co2_ppm,
        r.temp_c, r.humidity_pct, r.fan_duty, r.window_state, r.consent]);
    }
    return res.status(200).json({ ok: true, inserted: v.value.length });
  } catch (e) {
    console.error("ingest failed:", e);
    return res.status(500).json({ error: "could not ingest" });
  } finally {
    await client.end().catch(() => {});
  }
}
```

- [ ] **Step 2: Build typechecks**

Run: `cd site && npm run build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add site/api/ingest.ts
git commit -m "feat(ingest): token-authed /api/ingest writes readings to Supabase"
```

- [ ] **Step 4: e2e (needs VENTIS_INGEST_TOKEN + SUPABASE_DB_URL in Vercel, redeploy)**

```bash
# unauth -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ventis.vercel.app/api/ingest -H "Content-Type: application/json" -d '{"readings":[]}'
# authed test row -> 200 {"ok":true,"inserted":1}; then delete it from readings
curl -s -X POST https://ventis.vercel.app/api/ingest -H "Content-Type: application/json" \
  -H "X-Ventis-Token: <token>" \
  -d '{"readings":[{"device_id":"ingest-test","timestamp":"2026-06-07 12:00:00","co2_ppm":500}]}'
```
Confirm 401 without token, 200 with. Delete the `ingest-test` rows after.

---

# Track B — Firmware hardening (🔧 HARDWARE-GATED)

> Every task here requires flashing `firmware/` to the ESP32 and observing it. A cold agent: write the code, run `pio run -e esp32dev` to confirm it compiles, then STOP and hand the on-device verification to Diego/cofounder.

## Task B1: 🔧 HARDWARE-GATED — shared-secret auth on mutating endpoints

**Files:** Modify `firmware/src/main.cpp`, `firmware/include/secrets.h`

- [ ] **Step 1:** In `secrets.h` add `#define DEVICE_TOKEN "<same value as VENTIS_INGEST_TOKEN>"`.
- [ ] **Step 2:** In `main.cpp`, add a helper near `setupServer()`:

```cpp
static bool authed(AsyncWebServerRequest *req) {
  if (req->hasHeader("X-Ventis-Token"))
    return req->getHeader("X-Ventis-Token")->value() == DEVICE_TOKEN;
  if (req->hasParam("token"))
    return req->getParam("token")->value() == DEVICE_TOKEN;
  return false;
}
```

- [ ] **Step 3:** At the top of each mutating/sensitive handler (`/control` POST, `/log/start`, `/log/stop`, `/outdoor` POST, `/insight` POST), add:

```cpp
if (!authed(req)) { req->send(401, "application/json", "{\"error\":\"unauthorized\"}"); return; }
```

Leave read-only `/data` and the dashboard GET open (or gate them too if the dashboard passes the token). Update the dashboard's `fetch()` calls (the inline JS, e.g. `/control`, `/insight`) to send `headers:{'X-Ventis-Token': TOKEN}` where `TOKEN` is injected into the page from `DEVICE_TOKEN`.
- [ ] **Step 4:** `pio run -e esp32dev` compiles. **🔧 STOP — hand off:** flash + verify `/control` and `/insight` reject without the token and work with it.
- [ ] **Step 5:** Commit (`feat(fw): shared-secret auth on mutating + /insight endpoints`).

## Task B2: 🔧 HARDWARE-GATED — Anthropic key protection

- [ ] Confirm Task B1 gates `/insight` POST (the credit-burn vector). Confirm the rotated key is in `secrets.h` (Prerequisite). Confirm `ANTHROPIC_MODEL` is defined once (memory noted a double-#define between `main.cpp` and `secrets.h` — remove the duplicate). `pio run` compiles. **🔧 STOP — hand off:** verify `/insight` works with the token and is rejected without it. Commit.

## Task B3: 🔧 HARDWARE-GATED — dual-write readings to /api/ingest

**Files:** Modify `firmware/src/main.cpp`, `config.h`, `secrets.h`

- [ ] **Step 1:** Add `#define INGEST_URL "https://ventis.vercel.app/api/ingest"` to `config.h`.
- [ ] **Step 2:** Add a `postToIngest()` alongside `logToSheets()` that builds a JSON `{"readings":[{...one sample...}]}` from the same fields and POSTs to `INGEST_URL` with header `X-Ventis-Token: DEVICE_TOKEN` (mirror the `HTTPClient`/`WiFiClientSecure` usage in `logToSheets`). Call it wherever `logToSheets()` is called (dual-write). On non-200, log + continue (the Sheet remains the fallback).
- [ ] **Step 3:** `pio run -e esp32dev` compiles. **🔧 STOP — hand off:** flash, run a short logging session, confirm rows appear in Supabase `readings` (via `analyze.py` or the Supabase table) AND still in the Sheet.
- [ ] **Step 4:** Commit (`feat(fw): dual-write readings to /api/ingest (Sheet stays as fallback)`).

> Follow-up (separate, later): once dual-write is proven over multiple runs, retire the Sheet ingestion path and prune. Out of scope here.

## Task B4: 🔧 HARDWARE-GATED — dashboard-refresh heap crash

**Files:** Modify `firmware/src/main.cpp`

- [ ] **Step 1: Reproduce + instrument.** The WROOM restarts when the dashboard is refreshed (memory). Add `Serial.printf("[heap] free=%u minfree=%u\n", ESP.getFreeHeap(), ESP.getMinFreeHeap());` at the start of `/data`, `/history`, and `/insight` handlers. Flash, refresh the dashboard repeatedly, watch the heap fall. **🔧 device required.**
- [ ] **Step 2: Likely culprits (fix the one the heap trace implicates):**
  - Large `String` concatenations building JSON in handlers (`/history`, `/data`) fragment the heap → build responses with a fixed buffer / `AsyncResponseStream` instead of growing `String`s.
  - The in-RAM history buffer being copied per request → stream it, or cap its size.
  - `/insight` holding the Anthropic response in multiple `String`s → free promptly.
- [ ] **Step 3:** `pio run` compiles. **🔧 STOP — hand off:** flash, hammer-refresh the dashboard, confirm `minfree` stabilizes and no restart. Commit.

---

## Task A3 / B5: Open the PR

- [ ] `git push -u Ventis feat-durability` ; PR to `main`. Merge Track A after its e2e; Track B merges only after on-device verification by Diego/cofounder (mark those commits clearly so an unverified firmware change isn't merged blind).

## Self-review notes
- Track A is fully cold-executable and reuses the consent function's hard-won fixes (pg default-import, `.js` extension, SSL) — call those out so they aren't rediscovered.
- Every firmware task is explicitly **🔧 HARDWARE-GATED** with a STOP-and-hand-off step; a cold agent compiles but does not claim on-device success.
- Idempotent ingest (`on conflict (device_id,timestamp) do nothing`) means dual-write can't create duplicate readings vs the Sheet→CI path.
- Out of scope: retiring the Sheet path (after dual-write proven), per-user auth, the main.cpp refactor (monolith) beyond what these tasks touch.
