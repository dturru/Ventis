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
  'humidity_pct', 'fan_duty', 'window_state', 'consent'
];

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    sheet.appendRow(buildRow_(p));
    return json_({ ok: true, rows: sheet.getLastRow() - 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
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
    blank_(p.device_id != null ? p.device_id : CONFIG.deviceId),
    blank_(p.condition != null ? p.condition : p.run),   // run -> condition
    num_(p.co2_ppm,  p.co2),                              // co2 -> co2_ppm
    num_(p.temp_c,   p.temp_in_c),                        // temp_in_c -> temp_c
    num_(p.humidity_pct),
    fanDuty_(p),                                          // real duty if sent, else 0/100 from fan_on
    blank_(p.window_state),                               // not measured by v1 yet -> blank
    (p.consent != null ? truthy_(p.consent) : CONFIG.consent)
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

function truthy_(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
function blank_(v)  { return (v === null || v === undefined || v === '') ? '' : v; }
function json_(o)   { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
