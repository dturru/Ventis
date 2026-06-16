/**
 * Ventis telemetry — Google Apps Script Web App
 *
 * Deployed as a Web App bound to the project's Google Sheet. The ESP32 firmware
 * (firmware/src/main.cpp -> logToSheets()) POSTs one JSON object per sample to the
 * deployment's /exec URL; doPost() appends one row in the LOCKED council schema:
 *
 *   timestamp, device_id, condition, co2_ppm, temp_c, humidity_pct,
 *   fan_duty, window_state, consent
 *
 * Forward/backward compatible by design:
 *  - Reads CURRENT firmware keys (run / co2 / temp_in_c / humidity_pct / fan_on / fan_duty)
 *    AND future schema-native keys (condition / co2_ppm / temp_c / device_id / window_state / consent).
 *  - Prefers schema-native keys when present, so a firmware reflash needs no script change.
 *  - Missing channels are written as BLANK cells (null), never -1 or 0 phantoms.
 *
 * IMPORTANT (no-reflash deploy): paste this into the SAME Apps Script project already
 * behind the firmware's SHEETS_URL, then Deploy -> Manage deployments -> edit the existing
 * deployment -> New version. That keeps the /exec URL identical. A brand-new project gets a
 * new URL and WOULD require a firmware reflash to change SHEETS_URL.
 */

// ===== CONFIG — edit per deployment =====
const CONFIG = {
  sheetName: 'telemetry',   // appends here; use a NEW tab so it doesn't collide with the
                            // legacy 8-column data. Auto-created with headers if missing.
  deviceId:  'ventis-01',   // pseudonym; used only if the POST omits device_id. NO real names.
  consent:   true,          // did the logged occupant(s) consent? Set per deployment.
};

// Canonical column order = the data contract. Do not reorder casually.
const SCHEMA = [
  'timestamp', 'device_id', 'condition', 'co2_ppm', 'temp_c',
  'humidity_pct', 'fan_duty', 'window_state', 'consent', 'run_id'
];

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    // Write auth: the /exec URL is public (committed in firmware config.h), so without
    // this check anyone could POST and poison the dataset. The firmware sends `token`
    // (from gitignored secrets.h); the expected value lives in a Script Property so it's
    // never in the repo. Rollout is order-independent and lossless: while the property is
    // UNSET the endpoint behaves as before (accepts all), and the instant you set it,
    // only the matching token is accepted. Set it AFTER reflashing devices with the token.
    const expected = PropertiesService.getScriptProperties().getProperty('SHEETS_TOKEN');
    if (expected && p.token !== expected) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    // Run Launcher: set the control tab and bump seq so the device starts/stops.
    if (p.action === 'control') {
      const seq = setControl_(p.logging === true, p.label != null ? p.label : '');
      return json_({ ok: true, seq: seq });
    }
    const sheet = getSheet_();
    sheet.appendRow(buildRow_(p));
    return json_({ ok: true, rows: sheet.getLastRow() - 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Write the control tab atomically and return the new seq. label is sanitized through
// the same label_() guard the telemetry path uses, so it stays anonymized + canonical-safe.
function setControl_(logging, label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('control');
  if (!sh) {
    sh = ss.insertSheet('control');
    sh.getRange('A1:C1').setValues([['logging', 'label', 'seq']]);
    sh.getRange('A2:C2').setValues([[false, '', 0]]);
  }
  const cur = sh.getRange('A2:C2').getValues()[0];
  const nextSeq = (Number(cur[2]) || 0) + 1;
  sh.getRange('A2:C2').setValues([[logging, label_(label), nextSeq]]);
  return nextSeq;
}

// Remote logging control. The device polls this (GET) every minute and applies a
// command only when `seq` changes — so it never fights the on-device web UI.
// To start/stop a run from ANY device (incl. your phone, off-campus): open the
// `control` tab, set logging TRUE/FALSE, set the label, and BUMP seq by 1.
// `lastTelemetryAt` is extra (device ignores it) — used by the Run Launcher to
// judge device liveness before issuing a start/stop command.
function doGet() {
  try {
    const c = getControl_();
    return json_({ logging: c.logging, label: c.label, seq: c.seq, lastTelemetryAt: lastTelemetryAt_() });
  } catch (err) {
    return json_({ logging: false, label: '', seq: 0, lastTelemetryAt: null, error: String(err) });
  }
}

// ISO timestamp of the most recent telemetry row (first column), or null if none.
// Used by the Run Launcher to judge device liveness. Device ignores this extra field.
function lastTelemetryAt_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheetName);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const v = sheet.getRange(sheet.getLastRow(), 1).getValue();
  return v ? new Date(v).toISOString() : null;
}

function getControl_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('control');
  if (!sh) {
    sh = ss.insertSheet('control');
    sh.getRange('A1:C1').setValues([['logging', 'label', 'seq']]);
    sh.getRange('A2:C2').setValues([[false, '', 0]]);
  }
  const v = sh.getRange('A2:C2').getValues()[0];
  return { logging: truthy_(v[0]), label: blank_(v[1]), seq: Number(v[2]) || 0 };
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(SCHEMA);  // header on first write
  return sheet;
}

// Map legacy-or-native payload -> canonical row.
function buildRow_(p) {
  return [
    p.timestamp || new Date().toISOString(),
    deviceId_(p.device_id != null ? p.device_id : CONFIG.deviceId),
    label_(p.condition != null ? p.condition : p.run),   // run -> condition (sanitized)
    num_(p.co2_ppm,  p.co2),                              // co2 -> co2_ppm
    num_(p.temp_c,   p.temp_in_c),                        // temp_in_c -> temp_c
    num_(p.humidity_pct),
    fanDuty_(p),                                          // real duty if sent, else 0/100 from fan_on
    blank_(p.window_state),                               // not measured by v1 yet -> blank
    (p.consent != null ? truthy_(p.consent) : CONFIG.consent),
    runId_(p.run_id)                                      // <device>_<start epoch>; blank for legacy rows
  ];
}

// ---- helpers ----

// First finite, non-sentinel number; else '' (blank). Drops -1 missing-channel sentinels.
function num_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!isFinite(n) || n === -1) continue;
    return n;
  }
  return '';
}

// Prefer a real 0-100 duty if firmware sends it; else derive coarse 0/100 from fan_on.
function fanDuty_(p) {
  if (p.fan_duty != null && p.fan_duty !== '') {
    const n = Number(p.fan_duty);
    return isFinite(n) ? n : '';
  }
  if (p.fan_on != null) return truthy_(p.fan_on) ? 100 : 0;
  return '';
}

// ---- privacy guards (anonymization enforced at ingest) ----
// The dataset promises "no names, no room identifiers." We can't reliably detect an
// arbitrary person's name in code, but we CAN enforce the safe SHAPE of the two free-text
// fields so identifying info never reaches the sheet, even on operator error. Sanitizing
// happens here in buildRow_ — BEFORE appendRow — so the raw string is never persisted.

// Condition labels follow `building_condition_occupancy` (e.g. "choates_windowclosed_1person").
// Force lowercase + [a-z0-9_] only, and strip 3+ digit runs (room numbers like 302, years
// like 2026). Occupancy counts (1-2 digits, e.g. "2person") are preserved.
function label_(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase()
    .replace(/\d{3,}/g, '')             // drop room numbers / years
    .replace(/[^a-z0-9_]+/g, '_')       // safe charset only (kills free-text, spaces, punctuation)
    .replace(/_+/g, '_')                // collapse repeats
    .replace(/^_+|_+$/g, '')            // trim
    .slice(0, 64);                      // length cap
}

// device_id must be a pseudonym (e.g. "ventis-01"), never a person's name. Anything that
// doesn't fit the pseudonym shape falls back to the configured pseudonym.
function deviceId_(v) {
  var s = (v === null || v === undefined) ? '' : String(v).toLowerCase().trim();
  return /^ventis[-_][a-z0-9]+$/.test(s) ? s : CONFIG.deviceId;
}

// run_id is device-generated (<device_id>_<start_epoch>) — no PII, but sanitize defensively
// to a safe key charset. Blank for legacy rows that predate the run_id firmware.
function runId_(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9_\-]+/g, '').slice(0, 48);
}

function truthy_(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
function blank_(v)  { return (v === null || v === undefined || v === '') ? '' : v; }
function json_(o)   { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
