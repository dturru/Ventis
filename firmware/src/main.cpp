#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <time.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <SensirionI2CScd4x.h>
#include <Adafruit_SSD1306.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <LittleFS.h>
#include "config.h"

#ifndef ANTHROPIC_MODEL
#define ANTHROPIC_MODEL "claude-haiku-4-5-20251001"
#endif

inline float toF(float c) { return c * 9.0f / 5.0f + 32.0f; }

// ── Sensors ──────────────────────────────────────────────────────────────────

SensirionI2cScd4x scd40;
OneWire           oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);
Adafruit_SSD1306  oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
AsyncWebServer    server(80);

// ── State ────────────────────────────────────────────────────────────────────

struct Readings {
    uint16_t co2          = 0;
    float    tempIn       = 0.0f;   // °C, from SCD40
    float    humidity     = 0.0f;   // %RH
    float    tempOut      = 0.0f;   // °C, from wireless C3 or wired DS18B20
    bool     tempOutValid = false;  // false when no fresh outdoor source — disables COOLING mode
    bool     valid        = false;
} readings;

enum FanReason { NONE, COOLING, CO2_HIGH, HUMIDITY_HIGH, MANUAL };
enum SwitchMode { SW_AUTO, SW_FORCE_ON };
enum OverrideMode { OVR_AUTO, OVR_ON, OVR_OFF };

SwitchMode readSwitch() {
    return digitalRead(PIN_SWITCH_ON) == LOW ? SW_FORCE_ON : SW_AUTO;
}

struct FanState {
    bool      on     = false;
    FanReason reason = NONE;
} fan;

OverrideMode override_mode = OVR_AUTO;  // set via POST /control?mode=auto|on|off

// User-set indoor cooling setpoint. Fan triggers COOLING only when indoor > setpoint
// AND outdoor is colder by COOLING_DELTA_C. Default 75°F (23.89°C). Range 60-90°F.
float coolingSetpointC = 23.89f;
const float SETPOINT_MIN_F = 60.0f;
const float SETPOINT_MAX_F = 90.0f;

// User-set manual-mode fan duty (0-255). Default 255 = 100% to preserve old behavior.
// Only takes effect when override_mode == OVR_ON; ignored in auto and off modes.
uint8_t manualDuty = FAN_DUTY_MAX;

// History ring buffer — 60 samples × 5s cadence = 5 min rolling window
#define HISTORY_SIZE 60
struct HistorySample {
    unsigned long t_ms;       // millis() at capture
    uint16_t      co2;
    float         tempIn;     // °C
    float         humidity;   // %RH
    float         tempOut;    // °C
    bool          fanOn;
};
HistorySample history[HISTORY_SIZE];
uint8_t       historyHead = 0;
bool          historyFull = false;

unsigned long lastScd40Read   = 0;
unsigned long lastDs18b20Read = 0;

float         tempOutWired     = 0.0f;   // from wired DS18B20 (currently NOT wired on v1 hub)
bool          tempOutWiredValid = false;  // set true on first successful DS18B20 read
unsigned long lastWiredOkMs    = 0;      // millis() of most recent successful DS18B20 read
float         tempOutWireless  = 0.0f;   // from C3 outdoor node
unsigned long lastOutdoorPostMs = 0;      // 0 = never received

bool          oledOk           = false;   // set by probe in setup(); guards all OLED I2C ops
unsigned long lastLogMs        = 0;
bool          logEnabled       = false;

// Latest insight cache — populated by /insight POST handler AND by periodic
// auto-trigger in loop(). Served via /data so viewer clients see live content
// even when no controller has tapped. Source surfaces "live" (Anthropic ok),
// "fallback" (rule-based degradation when WiFi/API failed), or "init" (boot,
// no insight generated yet). Dashboard maps these to a visible chip so judges
// see graceful degradation as a feature, not a bug.
String cachedInsightText   = "Just booting up. First reading in a moment.";
String cachedInsightSource = "init";
char   cachedInsightTs[25] = "boot";

// Auto-regen: one boot trigger ~8s after first valid SCD40 reading, then every
// AUTO_INSIGHT_INTERVAL_MS. Keeps viewer dashboards fresh even when controller
// hasn't tapped. Each call blocks loop() ~2-3s for the Anthropic round-trip;
// SCD40 5s cadence absorbs that, AsyncTCP /data polling continues uninterrupted.
unsigned long lastAutoInsightMs    = 0;
unsigned long firstValidReadingMs  = 0;
bool          autoInsightBootDone  = false;
const unsigned long AUTO_INSIGHT_INTERVAL_MS   = 60000;  // 60s between periodic auto-regens
const unsigned long AUTO_INSIGHT_BOOT_DELAY_MS = 8000;   // wait 8s after first reading before first auto
char          runLabel[64]     = "unlabeled";
char          runId[40]        = "";        // <DEVICE_ID>_<start_epoch>, set on run start, persisted in NVS
uint32_t      logRowCount      = 0;

// Logging persistence (NVS) + remote control. logEnabled/runLabel survive a
// reboot so a crash or power-blip RESUMES the run instead of going silent; the
// device also polls the Apps Script doGet for start/stop commands so a run can be
// controlled from anywhere (outbound HTTPS — no LAN/inbound access needed).
Preferences   prefs;
uint32_t      lastCtrlSeq      = 0;       // last applied remote command id
unsigned long lastCtrlPollMs   = 0;

// /insight is handled synchronously in the AsyncWebServer handler — see setupServer().
// Previous async/loop-dispatch architecture had a dangling-pointer + TCP-tear-down
// bug that dropped responses to the browser. Sync handler trades 2-3s of /data
// polling pause for end-to-end reliability.

// ── Control logic ─────────────────────────────────────────────────────────────

FanState evaluateFan(const Readings &r) {
    FanState s;
    if (!r.valid) return s;

    if (r.co2 > CO2_THRESHOLD) {
        s.on = true; s.reason = CO2_HIGH; return s;
    }
    if (r.humidity > HUMIDITY_THRESHOLD) {
        s.on = true; s.reason = HUMIDITY_HIGH; return s;
    }
    // Cool only when (a) we have valid outdoor reading, (b) indoor is above the
    // user's comfort setpoint, AND (c) outdoor air is actually colder by ΔT.
    if (r.tempOutValid
        && r.tempIn > coolingSetpointC
        && (r.tempIn - r.tempOut) > COOLING_DELTA_C) {
        s.on = true; s.reason = COOLING; return s;
    }
    return s;
}

const char *reasonStr(FanReason r) {
    switch (r) {
        case CO2_HIGH:      return "CO2";
        case HUMIDITY_HIGH: return "HUMIDITY";
        case COOLING:       return "COOLING";
        case MANUAL:        return "MANUAL";
        default:            return "---";
    }
}

// PWM duty selection — relay still gates 12V (true off), PWM scales speed when fan.on.
// NF-P12 Redux doesn't fully stop at duty 0, so relay + PWM both matter.
uint8_t computeDuty(const FanState &f, const Readings &r) {
    if (!f.on) return 0;
    if (f.reason == MANUAL) return manualDuty;  // user-set 0-255 via dashboard slider
    if (f.reason == CO2_HIGH && r.co2 >= CO2_ALARM_PPM) return FAN_DUTY_MAX;
    if (f.reason == COOLING) return FAN_DUTY_MAX;
    return FAN_DUTY_MID;
}

void setFanOutputs(const FanState &f, const Readings &r) {
    digitalWrite(PIN_RELAY, f.on ? RELAY_ON : RELAY_OFF);
    ledcWrite(FAN_PWM_CHANNEL, computeDuty(f, r));
}

void pushHistory(const Readings &r, bool fanOn) {
    HistorySample &s = history[historyHead];
    s.t_ms     = millis();
    s.co2      = r.co2;
    s.tempIn   = r.tempIn;
    s.humidity = r.humidity;
    s.tempOut  = r.tempOut;
    s.fanOn    = fanOn;
    historyHead = (historyHead + 1) % HISTORY_SIZE;
    if (historyHead == 0) historyFull = true;
}

// ── Google Sheets logger ─────────────────────────────────────────────────────

void logToSheets() {
    if (!readings.valid || strlen(SHEETS_URL) == 0) return;
    char ts[25] = "unknown";
    struct tm t;
    if (getLocalTime(&t)) strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &t);
    char body[448];
    snprintf(body, sizeof(body),
        "{\"token\":\"%s\",\"device_id\":\"%s\",\"run_id\":\"%s\",\"timestamp\":\"%s\",\"run\":\"%s\",\"co2\":%u,\"temp_in_c\":%.2f,"
        "\"humidity_pct\":%.2f,\"temp_out_c\":%.2f,\"fan_on\":%s,\"fan_duty\":%u,\"reason\":\"%s\"}",
        SHEETS_TOKEN, DEVICE_ID, runId, ts, runLabel, readings.co2, readings.tempIn, readings.humidity, readings.tempOut,
        fan.on ? "true" : "false", computeDuty(fan, readings), reasonStr(fan.reason));
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.begin(client, SHEETS_URL);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.addHeader("Content-Type", "application/json");
    http.POST(body);
    http.end();
    Serial.printf("[LOG] %s co2=%u\n", ts, readings.co2);
}

// ── Logging state persistence + remote control ───────────────────────────────

void persistLogState() {
    prefs.putBool("logOn", logEnabled);
    prefs.putString("label", runLabel);
    prefs.putString("runId", runId);
}

// Single path for applying a logging command, whether it came from the on-device
// web UI or the remote control tab. Persists to NVS so it survives a reboot.
void applyLogCommand(bool enable, const char *label, bool resetCounters) {
    if (label && label[0]) {
        strncpy(runLabel, label, sizeof(runLabel) - 1);
        runLabel[sizeof(runLabel) - 1] = '\0';
    }
    if (enable && (!logEnabled || resetCounters)) {
        logRowCount = 0;
        lastLogMs   = 0;   // log immediately on (re)start
        // New run → mint a run_id (<device>_<start epoch>). Persisted below, so a reboot
        // mid-run RESUMES the same run_id rather than splitting the run. Falls back to
        // uptime millis if NTP hasn't synced yet (run_id stays unique, just not wall-clock).
        time_t now = time(nullptr);
        long stamp = (now > 1700000000) ? (long)now : (long)millis();
        snprintf(runId, sizeof(runId), "%s_%ld", DEVICE_ID, stamp);
    }
    logEnabled = enable;
    persistLogState();
}

// Poll the Apps Script doGet for a remote logging command. Outbound HTTPS, so it
// works from anywhere the device has internet — no inbound/LAN access needed. A
// command applies only when its `seq` increments, so it never fights the on-device
// web UI: you trigger it by editing the control tab and bumping seq.
void pollControl() {
    if (strlen(SHEETS_URL) == 0 || WiFi.status() != WL_CONNECTED) return;
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    if (!http.begin(client, SHEETS_URL)) return;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int code = http.GET();
    if (code == 200) {
        JsonDocument doc;
        if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
            uint32_t seq = doc["seq"] | 0;
            if (seq != lastCtrlSeq) {
                bool        enable = doc["logging"] | false;
                const char *label  = doc["label"]  | "";
                applyLogCommand(enable, label, true);
                lastCtrlSeq = seq;
                prefs.putUInt("ctrlSeq", lastCtrlSeq);
                Serial.printf("[CTRL] seq %u: logging=%s label=%s\n",
                              seq, enable ? "ON" : "OFF", runLabel);
            }
        }
    }
    http.end();
}

// ── RGB LED ──────────────────────────────────────────────────────────────────

void updateLed(uint16_t co2, bool valid) {
    // ledc PWM — channels 2=R, 3=G (timer 1). Channels 0 + 1 are off-limits:
    // channel 0 belongs to fan PWM, channel 1 shares timer 0 with channel 0.
    if (!valid || logEnabled) {
        ledcWrite(2, 0); ledcWrite(3, 0); digitalWrite(PIN_LED_B, LOW);
        return;
    }
    // Green <800 | Amber 800-999 | Red ≥1000. 20 ppm hysteresis on downward edges.
    static uint8_t state = 0;  // 0=green, 1=amber, 2=red
    if (state == 0) {
        if (co2 >= CO2_ALARM_PPM)       state = 2;
        else if (co2 >= CO2_THRESHOLD)  state = 1;
    } else if (state == 1) {
        if (co2 >= CO2_ALARM_PPM)             state = 2;
        else if (co2 < CO2_THRESHOLD - 20)    state = 0;
    } else {
        if (co2 < CO2_ALARM_PPM - 20)         state = 1;
    }
    if (state == 2) {       ledcWrite(2, 255); ledcWrite(3, 0); }
    else if (state == 1) {  ledcWrite(2, 255); ledcWrite(3, 40);  }  // amber: red-dominant, small green for warm tint
    else {                  ledcWrite(2, 0);   ledcWrite(3, 255); }
    digitalWrite(PIN_LED_B, LOW);
    static uint8_t lastLogged = 255;
    if (state != lastLogged) { Serial.printf("[LED] state=%d co2=%u\n", state, co2); lastLogged = state; }
}

// ── OLED ─────────────────────────────────────────────────────────────────────

void updateOled() {
    if (!oledOk) return;
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);

    oled.printf("CO2:  %4u ppm\n",   readings.co2);
    oled.printf("IN:   %.1fF  %.0f%%\n", toF(readings.tempIn), readings.humidity);
    if (readings.tempOutValid) oled.printf("OUT:  %.1fF\n", toF(readings.tempOut));
    else                       oled.printf("OUT:  --  offline\n");
    oled.printf("FAN:  %s  %s\n",
        fan.on ? "ON " : "OFF",
        fan.on ? reasonStr(fan.reason) : "");
    oled.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    if (logEnabled) {
        oled.printf("LOG: %s (%u)\n", runLabel, logRowCount);
    }

    oled.display();
}

// ── /insight helpers ─────────────────────────────────────────────────────────

// Used when ANTHROPIC_API_KEY is missing, WiFi is down, or the API call fails.
// Cites real sensor numbers instead of generic baked text.
String fallbackInsight() {
    String s;
    if (!readings.valid) {
        s = "Sensors are still warming up — give it a moment.";
    } else if (readings.co2 >= CO2_ALARM_PPM) {
        s = "CO2 is elevated at " + String(readings.co2) + " ppm. ";
        s += fan.on ? "Fan is running to flush the room." : "Consider switching to manual on or opening a window.";
    } else if (readings.co2 >= CO2_THRESHOLD) {
        s = "CO2 climbing — " + String(readings.co2) + " ppm. ";
        s += fan.on ? "Fan kicked on automatically." : "Below the active-ventilation threshold for now.";
    } else {
        s = "Air looks good: " + String(readings.co2) + " ppm CO2, "
          + String(toF(readings.tempIn), 0) + "F indoor, " + String((int)readings.humidity) + "% RH.";
    }
    return s;
}

// Compact sensor snapshot the model sees. Keep this dense — every line is tokens.
String buildInsightUserMessage() {
    float setpointF = coolingSetpointC * 9.0f / 5.0f + 32.0f;
    float indoorF   = toF(readings.tempIn);
    float outdoorF  = toF(readings.tempOut);

    String outStr = readings.tempOutValid
        ? "outdoor " + String(outdoorF, 1) + "F"
        : "outdoor probe offline (cooling disabled)";
    String msg = "Now: CO2 " + String(readings.co2) + " ppm, indoor "
               + String(indoorF, 1) + "F / " + String((int)readings.humidity)
               + "% RH, " + outStr + ". Cooling setpoint " + String(setpointF, 0) + "F.\n";

    uint8_t count = historyFull ? HISTORY_SIZE : historyHead;
    if (count >= 2) {
        uint8_t startIdx = historyFull ? historyHead : 0;
        uint8_t lastIdx  = (historyHead == 0 ? HISTORY_SIZE - 1 : historyHead - 1);
        uint16_t startCo2 = history[startIdx].co2;
        uint16_t endCo2   = history[lastIdx].co2;
        int16_t  delta    = (int16_t)endCo2 - (int16_t)startCo2;
        uint32_t spanMs   = history[lastIdx].t_ms - history[startIdx].t_ms;
        uint32_t spanMin  = spanMs / 60000;  // integer minutes
        if (spanMin == 0) spanMin = 1;

        uint16_t peakCo2 = startCo2;
        for (uint8_t i = 0; i < count; i++) {
            uint8_t idx = (startIdx + i) % HISTORY_SIZE;
            if (history[idx].co2 > peakCo2) peakCo2 = history[idx].co2;
        }

        const char* dir = (delta >  50) ? "climbing"
                        : (delta < -50) ? "falling"  : "steady";
        msg += "Last " + String(spanMin) + " min: " + String(startCo2) + " -> " + String(endCo2)
             + " ppm (" + (delta >= 0 ? "+" : "") + String(delta) + ", " + dir + ", peak " + String(peakCo2) + ").\n";

        int rate = (int)(delta * 60L / (long)spanMs * 1000);  // ppm/min, signed
        if (delta >  200) msg += "Trend note: rose " + String(delta) + " ppm in " + String(spanMin) + " min — fast climb.\n";
        if (delta < -200) msg += "Trend note: dropped " + String(-delta) + " ppm in " + String(spanMin) + " min — fast flush.\n";
        if (peakCo2 >= endCo2 + 150 && delta < 0) msg += "Trend note: recovering from a peak of " + String(peakCo2) + " ppm.\n";
        if (endCo2 == peakCo2 && delta > 100)     msg += "Trend note: currently at the highest reading in this window.\n";
    }

    msg += "Fan: ";
    msg += fan.on ? "ON" : "OFF";
    msg += " (";
    msg += (override_mode == OVR_ON)  ? "manual on"
         : (override_mode == OVR_OFF) ? "manual off"
                                      : "auto";
    if (fan.on) {
        msg += String(", reason ") + reasonStr(fan.reason);
        msg += ", duty " + String((int)(computeDuty(fan, readings) * 100 / 255)) + "%";
    }
    msg += ").\n";

    // Ventilation tradeoff — explicit physics framing so the model reasons about
    // the decision (vent or hold), not just narrates the snapshot. Skipped when
    // outdoor probe is offline (can't reason about a tradeoff without both sides).
    if (readings.tempOutValid) {
        float dT_indoor_outdoor = indoorF - outdoorF;   // + means outdoor is cooler
        float dT_indoor_setpoint = indoorF - setpointF; // + means above target
        bool co2Elevated = readings.co2 >= CO2_THRESHOLD;
        bool wantCooling = dT_indoor_setpoint > 0.5f;

        String trade = "Tradeoff: ";
        if (dT_indoor_outdoor > 2.0f) {
            trade += "outdoor is " + String(dT_indoor_outdoor, 0) + "F cooler than the room";
            if (wantCooling)      trade += " — venting both cools toward the " + String(setpointF, 0) + "F target AND dilutes CO2 in one motion (low-cost vent).";
            else if (co2Elevated) trade += " — venting now would dilute the CO2 but also cool the room below the " + String(setpointF, 0) + "F target.";
            else                  trade += " — air is clean and the room's at or below target; no reason to vent right now.";
        } else if (dT_indoor_outdoor < -2.0f) {
            trade += "outdoor is " + String(-dT_indoor_outdoor, 0) + "F warmer than the room";
            if (co2Elevated)      trade += " — venting would dilute the CO2 but warm the room (CO2 cost vs heat cost; CO2 usually wins).";
            else                  trade += " — venting now would warm the room with no CO2 benefit; holding is the right call.";
        } else {
            trade += "outdoor and indoor are within ~2F";
            if (co2Elevated)      trade += " — venting helps CO2 with negligible thermal impact (free vent).";
            else                  trade += " — nothing to do, conditions are matched.";
        }
        msg += trade + "\n";
    }

    return msg;
}

// JSON-escape a String for embedding inside double-quoted JSON strings.
String jsonEscape(const String& in) {
    String out;
    out.reserve(in.length() + 16);
    for (size_t i = 0; i < in.length(); i++) {
        char c = in.charAt(i);
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if ((uint8_t)c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

// Calls Anthropic Messages API. Sets `outSource` to "live" or "fallback".
// Returns the text to surface to the dashboard.
String callAnthropic(String& outSource) {
#ifndef ANTHROPIC_API_KEY
    outSource = "fallback";
    return fallbackInsight();
#else
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[insight] STA not connected — using fallback");
        outSource = "fallback";
        return fallbackInsight();
    }

    String userMsg = buildInsightUserMessage();
    // System prompt — Dodi 'dry observer' persona (2026-05-28 v2). Replaces the
    // cockney-spy voice after Opus 4.7 external review flagged it as a liability
    // with the AI-native jury (signals 'toy', causes mental discount of substance).
    // New voice: technically literate, first-person, lightly warm, no slang.
    // Pixel-art is unchanged. Mirror in dev/test_insight_prompt.py:SYSTEM_PROMPT
    // and Projects/Ventis/AI Insight Prompt.md once locked.
    String body = String("{\"model\":\"") + ANTHROPIC_MODEL + "\","
        + "\"max_tokens\":160,"
        + "\"system\":"
          "\"You are Dodi — an on-device air-quality monitor watching the room from inside a Dartmouth dorm. "
          "Speak in a calm, observant first-person voice: dry, technically literate, briefly warm, no slang. "
          "Sound like a quiet operator narrating their decisions out loud — not a chatbot, not a mascot, not a character. "
          "Given the room's recent sensor data, write a brief note (1-2 short sentences) the resident would read on their phone. "
          "Cite specific numbers from the input (CO2 ppm, temp, fan state). "
          "No emoji, no greeting, no bullet list, no exclamation points. Stay under 200 characters.\\n"
          "\\n"
          "Rules:\\n"
          "- If a 'Tradeoff:' line is present, USE IT to explain the decision in physical terms — this is the most important signal in the input. Examples of the kind of reasoning to surface: 'Outside is 18 cooler and the room is 3 above target — venting now cools you and clears the CO2 in one shot.' 'Outside is warmer than the room. Venting would heat you up, so holding the fan even with CO2 at 910 — the heat cost isn't worth it yet.' 'Outside and inside are within two degrees — free vent, no thermal penalty.' Reason out loud about WHY, not just WHAT.\\n"
          "- If CO2 is under 800 ppm and nothing else is notable, confirm the air is clean in ONE short sentence ('Holding at 640. Room is clean.'). Do NOT suggest opening windows or taking action when there is no problem.\\n"
          "- When the input has a 'Trend note' line, weave it in ('Up 320 in five minutes — someone joined the room.', 'Down 280 in five minutes, working through it.', 'Just hit a new high at 1,180. Fan on, flushing.'). Trend notes are second only to Tradeoff in importance.\\n"
          "- Use trend words ('climbing', 'rising', 'falling', 'dropping') only when the input states a direction in the 'Last N min' line. Never invent a trend.\\n"
          "- When the fan is on, name the reason from the input (CO2, COOLING, HUMIDITY) plainly and tie it to the tradeoff ('Fan on for CO2 — outdoor is cool enough to help', 'Cooling — outside is 18 cooler', 'Drying the room out').\\n"
          "- Lead with the decision when the tradeoff line is interesting; lead with the most striking fact otherwise (new high, ramp to 100%, crossed cooling line, outside flipped to help).\\n"
          "- Voice cues to AVOID: 'mate', 'guy', 'guv', 'right then', 'got eyes on it', 'situation', exclamation marks, theatrical phrasing. Voice cues to USE: short declaratives, concrete numbers, calm present-tense reasoning.\","
        + "\"messages\":[{\"role\":\"user\",\"content\":\"" + jsonEscape(userMsg) + "\"}]"
        + "}";

    WiFiClientSecure client;
    client.setInsecure();   // demo: skip cert check. For prod, bundle Anthropic root cert.
    HTTPClient http;
    http.setTimeout(5000);  // 5s — keep AsyncTCP handler under 8s task watchdog
    if (!http.begin(client, "https://api.anthropic.com/v1/messages")) {
        Serial.println("[insight] http.begin failed");
        outSource = "fallback";
        return fallbackInsight();
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-api-key", ANTHROPIC_API_KEY);
    http.addHeader("anthropic-version", "2023-06-01");

    int code = http.POST(body);
    String resp = http.getString();
    http.end();

    if (code != 200) {
        Serial.printf("[insight] HTTP %d: %s\n", code, resp.substring(0, 200).c_str());
        outSource = "fallback";
        return fallbackInsight();
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (err) {
        Serial.printf("[insight] parse error: %s\n", err.c_str());
        outSource = "fallback";
        return fallbackInsight();
    }

    const char* text = doc["content"][0]["text"];
    if (text == nullptr || strlen(text) == 0) {
        outSource = "fallback";
        return fallbackInsight();
    }

    outSource = "live";
    return String(text);
#endif
}

// ── Web server ────────────────────────────────────────────────────────────────

static const char INDEX_HTML[] PROGMEM = R"raw(<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ventis</title>
<style>
:root{--bg:#ffffff;--tile:#ffffff;--tile-alt:#f7faf6;--fg:#1f2a1f;--muted:#5e6b5e;--green:#1e6e3a;--green-hover:#155026;--green-light:#e8f5e9;--amber:#b87900;--amber-light:#fff7e0;--red:#c62828;--red-light:#ffebee;--accent:#1e6e3a;--border:#d5dfd5;--shadow:0 1px 2px rgba(30,110,58,.06);}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:16px;max-width:480px;margin:0 auto;-webkit-font-smoothing:antialiased;}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);}
h1{font-size:22px;font-weight:700;color:var(--green);letter-spacing:-.3px;}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;animation:pulse 2s ease-in-out infinite;}
@keyframes pulse{50%{opacity:.3;}}
.live{font-size:12px;color:var(--muted);font-weight:500;}
.tile{background:var(--tile);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow);}
.co2-tile{text-align:center;padding:24px 16px;transition:background .5s,border-color .5s;}
.co2-tile.green{background:linear-gradient(180deg,var(--green-light) 0%,var(--tile) 100%);border-color:#bedfc4;}
.co2-tile.amber{background:linear-gradient(180deg,var(--amber-light) 0%,var(--tile) 100%);border-color:#e8d28a;}
.co2-tile.red{background:linear-gradient(180deg,var(--red-light) 0%,var(--tile) 100%);border-color:#e8a8a8;}
.co2-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;font-weight:600;}
.co2-value{font-size:60px;font-weight:700;line-height:1;margin:8px 0;color:var(--fg);}
.co2-unit{font-size:16px;color:var(--muted);}
.co2-status{font-size:13px;margin-top:10px;font-weight:600;}
.co2-status.green{color:var(--green);}
.co2-status.amber{color:var(--amber);}
.co2-status.red{color:var(--red);}
.row{display:flex;gap:12px;}
.row .tile{flex:1;}
.metric-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:600;}
.metric-value{font-size:22px;font-weight:600;margin-top:4px;color:var(--fg);}
.metric-sub{font-size:12px;color:var(--muted);margin-top:2px;}
.fan-tile{display:flex;align-items:center;justify-content:space-between;background:var(--green);color:#fff;border-color:var(--green);}
.fan-tile.idle{background:var(--tile);color:var(--fg);border-color:var(--border);}
.fan-status{display:flex;flex-direction:column;}
.fan-state{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.85;}
.fan-duty{font-size:26px;font-weight:700;letter-spacing:-.3px;margin-top:2px;}
.fan-duty-suffix{font-size:14px;font-weight:500;opacity:.75;margin-left:4px;}
.fan-reason{font-size:11px;opacity:.75;margin-top:2px;}
.fan-icon-wrap{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.fan-tile.idle .fan-icon-wrap{background:var(--tile-alt);}
.fan-icon{width:26px;height:26px;color:#fff;}
.fan-tile.idle .fan-icon{color:var(--muted);}
.fan-tile.running .fan-icon{animation:fan-spin var(--fan-spin-dur,1.4s) linear infinite;}
@keyframes fan-spin{to{transform:rotate(360deg);}}
.chart-tile h3{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:600;margin-bottom:12px;}
#chart{width:100%;height:160px;display:block;}
.controls{display:flex;gap:8px;}
.controls button{flex:1;padding:12px;background:var(--tile-alt);border:1px solid var(--border);color:var(--fg);border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;transition:all .15s;font-family:inherit;}
.controls button:hover{border-color:var(--green);color:var(--green);}
.controls button.active{background:var(--green);border-color:var(--green);color:#ffffff;}
.insight-tile{display:none;background:var(--green-light);border-color:#bedfc4;}
.insight-tile.visible{display:block;}
.insight-text{font-size:14px;line-height:1.5;color:var(--fg);}
.insight-meta{font-size:11px;color:var(--muted);margin-top:8px;}
.btn-insight{width:100%;padding:14px;background:var(--green);border:none;color:white;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-bottom:12px;transition:background .15s;}
.btn-insight:hover{background:var(--green-hover);}
.btn-insight:disabled{opacity:.6;cursor:wait;}
.log-row{display:flex;gap:8px;align-items:center;}
.log-input{flex:1;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;color:var(--fg);background:var(--tile-alt);}
.log-input:focus{outline:none;border-color:var(--green);}
.log-btn{padding:10px 16px;border:1px solid var(--green);background:var(--green);color:white;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s;}
.log-btn:hover{background:var(--green-hover);border-color:var(--green-hover);}
.log-btn.stop{background:var(--tile);color:var(--red);border-color:var(--red);}
.log-btn.stop:hover{background:var(--red-light);}
.log-active{display:none;align-items:center;justify-content:space-between;}
.log-active.visible{display:flex;}
.log-active-info{display:flex;flex-direction:column;}
.log-active-label{font-weight:600;color:var(--green);font-size:14px;}
.log-active-rows{font-size:12px;color:var(--muted);margin-top:2px;}
.dodo-wrap{display:flex;justify-content:center;margin-bottom:-6px;z-index:2;position:relative;}
.dodo-mascot{width:80px;height:88px;position:relative;}
.dodo-mascot svg{width:100%;height:100%;display:block;overflow:visible;}
.dodo-mascot .eyes-calm,.dodo-mascot .eyes-alert,.dodo-mascot .eyes-distress{display:none;}
.dodo-mascot.calm .eyes-calm{display:block;}
.dodo-mascot.alert .eyes-alert{display:block;}
.dodo-mascot.distress .eyes-distress{display:block;}
.dodo-mascot.pixel-art{width:64px;height:72px;}
.dodo-mascot.pixel-art svg{shape-rendering:crispEdges;}
.dodo-mascot.pixel-art .wing-up-l,.dodo-mascot.pixel-art .wing-up-r{display:none;}
.dodo-mascot.pixel-art .tint,.dodo-mascot.pixel-art .sweat{display:none;}
.dodo-mascot.pixel-art.distress .tint,.dodo-mascot.pixel-art.distress .sweat{display:block;}
#dodo-pixel-v2 .dodo-side-r,#dodo-pixel-v2 .dodo-side-l{display:none;}
#dodo-pixel-v2.facing-right .body-group,#dodo-pixel-v2.facing-right .feet,#dodo-pixel-v2.facing-right .wing-down-l,#dodo-pixel-v2.facing-right .wing-down-r,#dodo-pixel-v2.facing-right .wing-up-l,#dodo-pixel-v2.facing-right .wing-up-r{display:none;}
#dodo-pixel-v2.facing-right .dodo-side-r{display:block;}
#dodo-pixel-v2.facing-left .body-group,#dodo-pixel-v2.facing-left .feet,#dodo-pixel-v2.facing-left .wing-down-l,#dodo-pixel-v2.facing-left .wing-down-r,#dodo-pixel-v2.facing-left .wing-up-l,#dodo-pixel-v2.facing-left .wing-up-r{display:none;}
#dodo-pixel-v2.facing-left .dodo-side-l{display:block;}
body.demo-mode .tile-sheets{display:none;}
header .location{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;font-weight:600;}
.dodi-callout-tile{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--green-light);border-color:#bedfc4;transition:background .4s,border-color .4s;}
.dodi-callout-tile.amber{background:var(--amber-light);border-color:#e8d28a;}
.dodi-callout-tile.red{background:var(--red-light);border-color:#e8a8a8;}
.dodi-text{flex:1;min-width:0;}
.dodi-label{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--green);}
.dodi-callout-tile.amber .dodi-label{color:var(--amber);}
.dodi-callout-tile.red .dodi-label{color:var(--red);}
.dodi-title{font-size:17px;font-weight:700;color:var(--fg);margin-top:2px;line-height:1.2;}
.dodi-sub{font-size:13px;color:var(--muted);margin-top:3px;}
.co2-tile{text-align:left;padding:16px;}
.co2-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.co2-badge{padding:5px 12px;border-radius:14px;font-size:11px;font-weight:700;color:white;background:var(--green);letter-spacing:.6px;flex-shrink:0;}
.co2-badge.amber{background:var(--amber);}
.co2-badge.red{background:var(--red);}
.co2-tile .co2-label{text-align:left;}
.co2-tile .co2-value{font-size:48px;line-height:1;margin:6px 0 4px;color:var(--green);}
.co2-tile.amber .co2-value{color:var(--amber);}
.co2-tile.red .co2-value{color:var(--red);}
.co2-tile .co2-unit{text-align:left;}
.co2-chart-mini{width:100%;height:60px;display:block;margin-top:6px;}
.metric-tile{text-align:left;}
.metric-tile .metric-value{font-size:24px;font-weight:600;margin-top:4px;color:var(--fg);}
.insight-tile.always-on{display:block;background:var(--green-light);border-color:#bedfc4;cursor:pointer;user-select:none;}
.insight-tile.always-on:active{opacity:.7;}
.insight-header{display:flex;align-items:center;gap:7px;margin-bottom:8px;}
.insight-dot{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;}
.insight-badge{font-size:10px;color:var(--green);font-weight:700;letter-spacing:.8px;}
.insight-status{font-size:9px;font-weight:700;letter-spacing:.6px;padding:2px 6px;border-radius:4px;margin-left:auto;}
.insight-status[data-state="live"]{background:#e5f3e8;color:#1e6e3a;}
.insight-status[data-state="fallback"]{background:#fff7e0;color:#7a5a00;}
.insight-status[data-state="init"]{background:#eef2f4;color:#5c6b73;}
.insight-latency{font-size:9px;color:var(--muted);font-weight:500;margin-left:6px;}
.outdoor-banner{display:none;background:#fff7e0;border:1px solid #e8d28a;color:#7a5a00;padding:10px 14px;border-radius:8px;margin:0 0 14px 0;font-size:13px;font-weight:600;}
.outdoor-banner.visible{display:block;}
.setpoint-row{display:flex;align-items:center;justify-content:center;gap:14px;}
.setpoint-btn{width:44px;height:44px;border-radius:8px;border:1px solid var(--border);background:var(--tile-alt);color:var(--fg);font-size:22px;font-weight:600;cursor:pointer;font-family:inherit;line-height:1;transition:all .12s;}
.setpoint-btn:hover{border-color:var(--green);color:var(--green);}
.setpoint-btn:active{background:var(--green);color:#fff;}
.setpoint-value{font-size:30px;font-weight:600;color:var(--fg);min-width:90px;text-align:center;}
.setpoint-sub{font-size:11px;color:var(--muted);margin-top:8px;text-align:center;}
.temp-tile{cursor:pointer;transition:background .15s;}
.temp-tile:hover{background:var(--tile-alt);}
.setpoint-chev{display:inline-block;font-size:10px;color:var(--muted);margin-left:4px;transition:transform .2s;}
.temp-tile.expanded .setpoint-chev{transform:rotate(180deg);}
.setpoint-pop{max-height:0;overflow:hidden;opacity:0;transition:max-height .25s ease,opacity .2s,margin-top .2s;}
.temp-tile.expanded .setpoint-pop{max-height:200px;opacity:1;margin-top:14px;}
.setpoint-pop-label{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;text-align:center;}
.manual-tile{cursor:pointer;transition:background .15s;}
.manual-tile:hover{background:var(--tile-alt);}
.manual-tile.expanded .setpoint-chev{transform:rotate(180deg);}
.manual-pop{max-height:0;overflow:hidden;opacity:0;transition:max-height .25s ease,opacity .2s,margin-top .2s;}
.manual-tile.expanded .manual-pop{max-height:200px;opacity:1;margin-top:14px;}
.viewer-badge{display:none;background:#eef2f4;border:1px solid #cdd6da;color:#5c6b73;padding:6px 12px;border-radius:14px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin:0 0 14px 0;text-align:center;}
body.viewer .viewer-badge{display:block;}
body.viewer .controls,
body.viewer .manual-pop,
body.viewer .setpoint-chev,
body.viewer .tile-sheets,
body.viewer #manual-tile,
body.viewer #temp-tile{cursor:default;}
body.viewer .controls,
body.viewer .tile-sheets{display:none !important;}
body.viewer .setpoint-chev{visibility:hidden;}
body.viewer #manual-tile{display:none !important;}
body.viewer .insight-tile.always-on{cursor:default;}
body.viewer .insight-tile.always-on:active{opacity:1;}
.duty-row{margin-top:14px;}
.duty-label{font-size:13px;color:var(--fg);font-weight:500;margin-bottom:8px;}
.duty-label #duty-val{color:var(--green);font-weight:700;margin-left:4px;}
.duty-slider{width:100%;-webkit-appearance:none;appearance:none;height:6px;background:var(--tile-alt);border-radius:3px;outline:none;}
.duty-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:var(--green);cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.2);}
.duty-slider::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:var(--green);cursor:pointer;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.2);}
.duty-sub{font-size:11px;color:var(--muted);margin-top:6px;}
/* --- sidebar nav + views (F1) --- */
.hamburger{background:none;border:none;font-size:22px;color:var(--green);cursor:pointer;padding:2px 8px;line-height:1;margin-right:2px;}
.sidebar{position:fixed;top:0;left:0;height:100%;width:226px;background:var(--tile);border-right:1px solid var(--border);box-shadow:2px 0 14px rgba(0,0,0,.08);transform:translateX(-100%);transition:transform .22s ease;z-index:50;padding:18px 0;}
.sidebar.open{transform:translateX(0);}
.sidebar-title{font-size:13px;font-weight:700;color:var(--green);letter-spacing:.5px;padding:0 20px 14px;border-bottom:1px solid var(--border);margin-bottom:8px;}
.nav-item{display:flex;align-items:center;gap:11px;padding:13px 20px;font-size:15px;color:var(--fg);cursor:pointer;font-weight:500;border-left:3px solid transparent;}
.nav-item:hover{background:var(--tile-alt);}
.nav-item.active{color:var(--green);border-left-color:var(--green);background:var(--green-light);}
.nav-ico{width:18px;text-align:center;}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.32);opacity:0;pointer-events:none;transition:opacity .22s;z-index:40;}
.scrim.open{opacity:1;pointer-events:auto;}
.view{display:none;}
.view.active{display:block;}
body.viewer .nav-controls{display:none;}
#trend-chart{width:100%;height:240px;display:block;}
.trend-cap{font-size:12px;color:var(--muted);margin-top:10px;text-align:center;}
/* --- dodi tip bubble (N1) --- */
.dodi-bubble{position:fixed;left:50%;top:62px;transform:translateX(-50%) translateY(8px);width:calc(100% - 40px);max-width:320px;background:var(--fg);color:#fff;padding:11px 14px;border-radius:12px;font-size:13px;line-height:1.45;box-shadow:0 6px 20px rgba(0,0,0,.24);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:60;}
.dodi-bubble.show{opacity:1;transform:translateX(-50%) translateY(0);}
.dodi-bubble::before{content:"";position:absolute;top:-6px;left:50%;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:7px solid var(--fg);}
</style>
<script defer src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
</head><body>
<header><button class="hamburger" onclick="toggleNav()" aria-label="menu">&#9776;</button><h1>Ventis</h1><span class="location" id="location">DORM ROOM</span></header>
<div class="viewer-badge">&#128065; Live view &middot; controls disabled</div>
<div class="outdoor-banner" id="outdoor-banner">&#9888; Outdoor sensor offline &mdash; cooling mode disabled until C3 node reports.</div>
<div class="scrim" id="scrim" onclick="toggleNav()"></div>
<nav class="sidebar" id="sidebar">
  <div class="sidebar-title">VENTIS</div>
  <div class="nav-item active" data-view="live" onclick="showView('live')"><span class="nav-ico">&#128065;</span>Live</div>
  <div class="nav-item" data-view="trend" onclick="showView('trend')"><span class="nav-ico">&#128200;</span>Trends</div>
  <div class="nav-item nav-controls" data-view="controls" onclick="showView('controls')"><span class="nav-ico">&#9881;</span>Controls</div>
</nav>
<div class="dodi-bubble" id="dodi-bubble"></div>
<div class="view active" id="view-live">
<div class="tile dodi-callout-tile" id="dodi-callout">
  <div class="dodo-mascot pixel-art calm" id="dodo-pixel-v2">
    <svg viewBox="0 0 32 36" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <defs>
        <g id="dodo-side-template">
          <!-- feathers -->
          <rect x="9" y="1" width="1" height="2" fill="#155026"/>
          <rect x="11" y="1" width="1" height="2" fill="#155026"/>
          <rect x="9" y="3" width="3" height="1" fill="#155026"/>
          <!-- head (left side of frame, oval) -->
          <rect x="6" y="4" width="9" height="1" fill="#0d4520"/>
          <rect x="5" y="5" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="5" width="9" height="1" fill="#1e6e3a"/>
          <rect x="15" y="5" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="6" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="6" width="11" height="1" fill="#1e6e3a"/>
          <rect x="16" y="6" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="7" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="7" width="2" height="1" fill="#1e6e3a"/>
          <rect x="7" y="7" width="3" height="1" fill="#2a8a48"/>
          <rect x="10" y="7" width="6" height="1" fill="#1e6e3a"/>
          <rect x="16" y="7" width="1" height="1" fill="#0d4520"/>
          <!-- eye (one visible, on side facing beak) -->
          <rect x="4" y="8" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="8" width="7" height="1" fill="#1e6e3a"/>
          <rect x="12" y="8" width="2" height="1" fill="#ffffff"/>
          <rect x="14" y="8" width="2" height="1" fill="#1e6e3a"/>
          <rect x="16" y="8" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="9" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="9" width="7" height="1" fill="#1e6e3a"/>
          <rect x="12" y="9" width="1" height="1" fill="#ffffff"/>
          <rect x="13" y="9" width="1" height="1" fill="#1a1a1a"/>
          <rect x="14" y="9" width="2" height="1" fill="#1e6e3a"/>
          <rect x="16" y="9" width="1" height="1" fill="#0d4520"/>
          <!-- head narrows + beak protrudes right -->
          <rect x="5" y="10" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="10" width="9" height="1" fill="#1e6e3a"/>
          <rect x="15" y="10" width="1" height="1" fill="#0d4520"/>
          <rect x="16" y="10" width="3" height="1" fill="#fbbf24"/>
          <rect x="19" y="10" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="11" width="1" height="1" fill="#0d4520"/>
          <rect x="7" y="11" width="7" height="1" fill="#1e6e3a"/>
          <rect x="14" y="11" width="1" height="1" fill="#0d4520"/>
          <rect x="15" y="11" width="6" height="1" fill="#fbbf24"/>
          <rect x="21" y="11" width="1" height="1" fill="#0d4520"/>
          <!-- beak max + hook starts -->
          <rect x="7" y="12" width="1" height="1" fill="#0d4520"/>
          <rect x="8" y="12" width="5" height="1" fill="#1e6e3a"/>
          <rect x="13" y="12" width="1" height="1" fill="#0d4520"/>
          <rect x="14" y="12" width="7" height="1" fill="#fbbf24"/>
          <rect x="21" y="12" width="1" height="1" fill="#a16207"/>
          <rect x="22" y="12" width="1" height="1" fill="#0d4520"/>
          <rect x="8" y="13" width="1" height="1" fill="#0d4520"/>
          <rect x="9" y="13" width="3" height="1" fill="#1e6e3a"/>
          <rect x="12" y="13" width="1" height="1" fill="#0d4520"/>
          <rect x="13" y="13" width="7" height="1" fill="#fbbf24"/>
          <rect x="20" y="13" width="2" height="1" fill="#a16207"/>
          <rect x="9" y="14" width="1" height="1" fill="#0d4520"/>
          <rect x="10" y="14" width="1" height="1" fill="#1e6e3a"/>
          <rect x="11" y="14" width="1" height="1" fill="#0d4520"/>
          <rect x="12" y="14" width="7" height="1" fill="#fbbf24"/>
          <rect x="19" y="14" width="2" height="1" fill="#a16207"/>
          <!-- hook tip downward -->
          <rect x="10" y="15" width="1" height="1" fill="#0d4520"/>
          <rect x="11" y="15" width="6" height="1" fill="#a16207"/>
          <!-- neck -->
          <rect x="8" y="16" width="1" height="1" fill="#0d4520"/>
          <rect x="9" y="16" width="7" height="1" fill="#1e6e3a"/>
          <rect x="16" y="16" width="1" height="1" fill="#0d4520"/>
          <rect x="7" y="17" width="1" height="1" fill="#0d4520"/>
          <rect x="8" y="17" width="9" height="1" fill="#1e6e3a"/>
          <rect x="17" y="17" width="1" height="1" fill="#0d4520"/>
          <!-- body egg -->
          <rect x="6" y="18" width="1" height="1" fill="#0d4520"/>
          <rect x="7" y="18" width="11" height="1" fill="#1e6e3a"/>
          <rect x="18" y="18" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="19" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="19" width="13" height="1" fill="#1e6e3a"/>
          <rect x="19" y="19" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="20" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="20" width="15" height="1" fill="#1e6e3a"/>
          <rect x="20" y="20" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="21" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="21" width="15" height="1" fill="#1e6e3a"/>
          <rect x="20" y="21" width="1" height="1" fill="#0d4520"/>
          <!-- belly shadow -->
          <rect x="4" y="22" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="22" width="8" height="1" fill="#1e6e3a"/>
          <rect x="13" y="22" width="6" height="1" fill="#093b1a"/>
          <rect x="19" y="22" width="1" height="1" fill="#1e6e3a"/>
          <rect x="20" y="22" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="23" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="23" width="8" height="1" fill="#1e6e3a"/>
          <rect x="13" y="23" width="6" height="1" fill="#093b1a"/>
          <rect x="19" y="23" width="1" height="1" fill="#1e6e3a"/>
          <rect x="20" y="23" width="1" height="1" fill="#0d4520"/>
          <rect x="4" y="24" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="24" width="7" height="1" fill="#1e6e3a"/>
          <rect x="12" y="24" width="7" height="1" fill="#093b1a"/>
          <rect x="19" y="24" width="1" height="1" fill="#1e6e3a"/>
          <rect x="20" y="24" width="1" height="1" fill="#0d4520"/>
          <rect x="5" y="25" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="25" width="6" height="1" fill="#1e6e3a"/>
          <rect x="12" y="25" width="6" height="1" fill="#093b1a"/>
          <rect x="18" y="25" width="1" height="1" fill="#1e6e3a"/>
          <rect x="19" y="25" width="1" height="1" fill="#0d4520"/>
          <!-- wing on body side (single visible wing) -->
          <rect x="7" y="20" width="6" height="1" fill="#155026"/>
          <rect x="6" y="21" width="7" height="1" fill="#155026"/>
          <rect x="13" y="21" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="22" width="6" height="1" fill="#155026"/>
          <rect x="6" y="23" width="6" height="1" fill="#155026"/>
          <rect x="7" y="24" width="5" height="1" fill="#0d4520"/>
          <!-- body narrows -->
          <rect x="5" y="26" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="26" width="13" height="1" fill="#1e6e3a"/>
          <rect x="19" y="26" width="1" height="1" fill="#0d4520"/>
          <rect x="6" y="27" width="1" height="1" fill="#0d4520"/>
          <rect x="7" y="27" width="11" height="1" fill="#1e6e3a"/>
          <rect x="18" y="27" width="1" height="1" fill="#0d4520"/>
          <rect x="7" y="28" width="1" height="1" fill="#0d4520"/>
          <rect x="8" y="28" width="9" height="1" fill="#1e6e3a"/>
          <rect x="17" y="28" width="1" height="1" fill="#0d4520"/>
          <rect x="8" y="29" width="1" height="1" fill="#0d4520"/>
          <rect x="9" y="29" width="7" height="1" fill="#1e6e3a"/>
          <rect x="16" y="29" width="1" height="1" fill="#0d4520"/>
          <rect x="9" y="30" width="7" height="1" fill="#0d4520"/>
          <!-- legs staggered + feet -->
          <rect x="9" y="31" width="2" height="3" fill="#d97706"/>
          <rect x="13" y="31" width="2" height="3" fill="#d97706"/>
          <rect x="8" y="34" width="4" height="1" fill="#d97706"/>
          <rect x="12" y="34" width="4" height="1" fill="#d97706"/>
          <rect x="8" y="35" width="4" height="1" fill="#0d4520"/>
          <rect x="12" y="35" width="4" height="1" fill="#0d4520"/>
        </g>
      </defs>
      <g class="dodo-side-r">
        <use href="#dodo-side-template"/>
      </g>
      <g class="dodo-side-l" transform="translate(32 0) scale(-1 1)">
        <use href="#dodo-side-template"/>
      </g>
      <g class="wing-down-l">
        <rect x="3" y="21" width="2" height="1" fill="#0d4520"/>
        <rect x="3" y="22" width="2" height="1" fill="#155026"/>
        <rect x="5" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="23" width="3" height="1" fill="#155026"/>
        <rect x="6" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="24" width="3" height="1" fill="#155026"/>
        <rect x="6" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="25" width="3" height="1" fill="#155026"/>
        <rect x="6" y="25" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="4" y="26" width="2" height="1" fill="#155026"/>
        <rect x="6" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="4" y="27" width="2" height="1" fill="#0d4520"/>
      </g>
      <g class="wing-down-r">
        <rect x="27" y="21" width="2" height="1" fill="#0d4520"/>
        <rect x="26" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="27" y="22" width="2" height="1" fill="#155026"/>
        <rect x="25" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="23" width="3" height="1" fill="#155026"/>
        <rect x="25" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="24" width="3" height="1" fill="#155026"/>
        <rect x="25" y="25" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="25" width="3" height="1" fill="#155026"/>
        <rect x="25" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="26" width="2" height="1" fill="#155026"/>
        <rect x="28" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="27" width="2" height="1" fill="#0d4520"/>
      </g>
      <g class="wing-up-l">
        <rect x="3" y="19" width="2" height="1" fill="#0d4520"/>
        <rect x="3" y="20" width="2" height="1" fill="#155026"/>
        <rect x="5" y="20" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="21" width="3" height="1" fill="#155026"/>
        <rect x="6" y="21" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="22" width="3" height="1" fill="#155026"/>
        <rect x="6" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="23" width="3" height="1" fill="#155026"/>
        <rect x="6" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="3" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="4" y="24" width="1" height="1" fill="#155026"/>
        <rect x="5" y="24" width="1" height="1" fill="#0d4520"/>
      </g>
      <g class="wing-up-r">
        <rect x="27" y="19" width="2" height="1" fill="#0d4520"/>
        <rect x="26" y="20" width="1" height="1" fill="#0d4520"/>
        <rect x="27" y="20" width="2" height="1" fill="#155026"/>
        <rect x="25" y="21" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="21" width="3" height="1" fill="#155026"/>
        <rect x="25" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="22" width="3" height="1" fill="#155026"/>
        <rect x="25" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="26" y="23" width="3" height="1" fill="#155026"/>
        <rect x="26" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="27" y="24" width="1" height="1" fill="#155026"/>
        <rect x="28" y="24" width="1" height="1" fill="#0d4520"/>
      </g>
      <g class="body-group">
        <!-- FEATHERS (y=0-3) -->
        <rect x="13" y="1" width="1" height="2" fill="#155026"/>
        <rect x="15" y="1" width="1" height="2" fill="#155026"/>
        <rect x="17" y="1" width="1" height="2" fill="#155026"/>
        <rect x="13" y="3" width="5" height="1" fill="#155026"/>
        <!-- HEAD TOP (y=4-6) -->
        <rect x="9" y="4" width="14" height="1" fill="#0d4520"/>
        <rect x="8" y="5" width="1" height="1" fill="#0d4520"/>
        <rect x="9" y="5" width="14" height="1" fill="#1e6e3a"/>
        <rect x="23" y="5" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="6" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="6" width="16" height="1" fill="#1e6e3a"/>
        <rect x="24" y="6" width="1" height="1" fill="#0d4520"/>
        <!-- HEAD with HIGHLIGHT (y=7) -->
        <rect x="7" y="7" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="7" width="2" height="1" fill="#1e6e3a"/>
        <rect x="10" y="7" width="4" height="1" fill="#2a8a48"/>
        <rect x="14" y="7" width="10" height="1" fill="#1e6e3a"/>
        <rect x="24" y="7" width="1" height="1" fill="#0d4520"/>
        <!-- HEAD bulk - EYE ZONE RESERVED (y=8-10) -->
        <rect x="7" y="8" width="1" height="2" fill="#0d4520"/>
        <rect x="8" y="8" width="16" height="2" fill="#1e6e3a"/>
        <rect x="24" y="8" width="1" height="2" fill="#0d4520"/>
        <rect x="8" y="10" width="1" height="1" fill="#0d4520"/>
        <rect x="9" y="10" width="14" height="1" fill="#1e6e3a"/>
        <rect x="23" y="10" width="1" height="1" fill="#0d4520"/>
        <!-- HEAD narrows (y=11) -->
        <rect x="9" y="11" width="1" height="1" fill="#0d4520"/>
        <rect x="10" y="11" width="12" height="1" fill="#1e6e3a"/>
        <rect x="22" y="11" width="1" height="1" fill="#0d4520"/>
        <!-- HEAD BOTTOM with beak protrusion (y=12) -->
        <rect x="10" y="12" width="1" height="1" fill="#0d4520"/>
        <rect x="11" y="12" width="2" height="1" fill="#1e6e3a"/>
        <rect x="13" y="12" width="6" height="1" fill="#fbbf24"/>
        <rect x="19" y="12" width="2" height="1" fill="#1e6e3a"/>
        <rect x="21" y="12" width="1" height="1" fill="#0d4520"/>
        <!-- BEAK protrudes below head (y=13-15) - HOOKED tip -->
        <rect x="12" y="13" width="1" height="1" fill="#0d4520"/>
        <rect x="13" y="13" width="6" height="1" fill="#fbbf24"/>
        <rect x="19" y="13" width="1" height="1" fill="#0d4520"/>
        <rect x="13" y="14" width="1" height="1" fill="#0d4520"/>
        <rect x="14" y="14" width="3" height="1" fill="#fbbf24"/>
        <rect x="17" y="14" width="1" height="1" fill="#a16207"/>
        <rect x="18" y="14" width="1" height="1" fill="#0d4520"/>
        <rect x="14" y="15" width="1" height="1" fill="#0d4520"/>
        <rect x="15" y="15" width="3" height="1" fill="#a16207"/>
        <!-- NECK - thin distinct between head and body (y=16-17) -->
        <rect x="11" y="16" width="1" height="1" fill="#0d4520"/>
        <rect x="12" y="16" width="8" height="1" fill="#1e6e3a"/>
        <rect x="20" y="16" width="1" height="1" fill="#0d4520"/>
        <rect x="10" y="17" width="1" height="1" fill="#0d4520"/>
        <rect x="11" y="17" width="10" height="1" fill="#1e6e3a"/>
        <rect x="21" y="17" width="1" height="1" fill="#0d4520"/>
        <!-- BODY widens into egg shape (y=18-21) -->
        <rect x="9" y="18" width="1" height="1" fill="#0d4520"/>
        <rect x="10" y="18" width="12" height="1" fill="#1e6e3a"/>
        <rect x="22" y="18" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="19" width="1" height="1" fill="#0d4520"/>
        <rect x="9" y="19" width="14" height="1" fill="#1e6e3a"/>
        <rect x="23" y="19" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="20" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="20" width="16" height="1" fill="#1e6e3a"/>
        <rect x="24" y="20" width="1" height="1" fill="#0d4520"/>
        <rect x="6" y="21" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="21" width="18" height="1" fill="#1e6e3a"/>
        <rect x="25" y="21" width="1" height="1" fill="#0d4520"/>
        <!-- BELLY SHADOW (y=22-25) -->
        <rect x="6" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="22" width="3" height="1" fill="#1e6e3a"/>
        <rect x="10" y="22" width="12" height="1" fill="#093b1a"/>
        <rect x="22" y="22" width="3" height="1" fill="#1e6e3a"/>
        <rect x="25" y="22" width="1" height="1" fill="#0d4520"/>
        <rect x="6" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="23" width="2" height="1" fill="#1e6e3a"/>
        <rect x="9" y="23" width="14" height="1" fill="#093b1a"/>
        <rect x="23" y="23" width="2" height="1" fill="#1e6e3a"/>
        <rect x="25" y="23" width="1" height="1" fill="#0d4520"/>
        <rect x="6" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="24" width="2" height="1" fill="#1e6e3a"/>
        <rect x="9" y="24" width="14" height="1" fill="#093b1a"/>
        <rect x="23" y="24" width="2" height="1" fill="#1e6e3a"/>
        <rect x="25" y="24" width="1" height="1" fill="#0d4520"/>
        <rect x="7" y="25" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="25" width="3" height="1" fill="#1e6e3a"/>
        <rect x="11" y="25" width="10" height="1" fill="#093b1a"/>
        <rect x="21" y="25" width="3" height="1" fill="#1e6e3a"/>
        <rect x="24" y="25" width="1" height="1" fill="#0d4520"/>
        <!-- BODY narrows (y=26-30) -->
        <rect x="7" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="26" width="16" height="1" fill="#1e6e3a"/>
        <rect x="24" y="26" width="1" height="1" fill="#0d4520"/>
        <rect x="8" y="27" width="1" height="1" fill="#0d4520"/>
        <rect x="9" y="27" width="14" height="1" fill="#1e6e3a"/>
        <rect x="23" y="27" width="1" height="1" fill="#0d4520"/>
        <rect x="9" y="28" width="1" height="1" fill="#0d4520"/>
        <rect x="10" y="28" width="12" height="1" fill="#1e6e3a"/>
        <rect x="22" y="28" width="1" height="1" fill="#0d4520"/>
        <rect x="10" y="29" width="1" height="1" fill="#0d4520"/>
        <rect x="11" y="29" width="10" height="1" fill="#1e6e3a"/>
        <rect x="21" y="29" width="1" height="1" fill="#0d4520"/>
        <rect x="11" y="30" width="10" height="1" fill="#0d4520"/>
        <!-- EYES (3 state groups, visibility toggled by .dodo-mascot.<state> .eyes-<state> CSS) -->
        <g class="eyes-calm">
          <rect x="10" y="9" width="3" height="3" fill="#ffffff"/>
          <rect x="19" y="9" width="3" height="3" fill="#ffffff"/>
          <rect x="11" y="10" width="1" height="1" fill="#1a1a1a"/>
          <rect x="20" y="10" width="1" height="1" fill="#1a1a1a"/>
        </g>
        <g class="eyes-alert">
          <rect x="10" y="8" width="3" height="4" fill="#ffffff"/>
          <rect x="19" y="8" width="3" height="4" fill="#ffffff"/>
          <rect x="11" y="10" width="1" height="1" fill="#1a1a1a"/>
          <rect x="20" y="10" width="1" height="1" fill="#1a1a1a"/>
        </g>
        <g class="eyes-distress">
          <rect x="10" y="9" width="1" height="1" fill="#1a1a1a"/>
          <rect x="12" y="9" width="1" height="1" fill="#1a1a1a"/>
          <rect x="11" y="10" width="1" height="1" fill="#1a1a1a"/>
          <rect x="10" y="11" width="1" height="1" fill="#1a1a1a"/>
          <rect x="12" y="11" width="1" height="1" fill="#1a1a1a"/>
          <rect x="19" y="9" width="1" height="1" fill="#1a1a1a"/>
          <rect x="21" y="9" width="1" height="1" fill="#1a1a1a"/>
          <rect x="20" y="10" width="1" height="1" fill="#1a1a1a"/>
          <rect x="19" y="11" width="1" height="1" fill="#1a1a1a"/>
          <rect x="21" y="11" width="1" height="1" fill="#1a1a1a"/>
        </g>
      </g>
      <!-- LEGS + FEET (separate group, excluded from distress shake) -->
      <g class="feet">
        <rect x="11" y="31" width="3" height="3" fill="#d97706"/>
        <rect x="18" y="31" width="3" height="3" fill="#d97706"/>
        <rect x="10" y="34" width="5" height="1" fill="#d97706"/>
        <rect x="17" y="34" width="5" height="1" fill="#d97706"/>
        <rect x="10" y="35" width="5" height="1" fill="#0d4520"/>
        <rect x="17" y="35" width="5" height="1" fill="#0d4520"/>
      </g>
    </svg>
  </div>
  <div class="dodi-text">
    <div class="dodi-label" id="dodi-label">AIR IS FRESH</div>
    <div class="dodi-title" id="dodi-title">Dodi is happy</div>
    <div class="dodi-sub" id="dodi-sub">Air quality is great</div>
  </div>
</div>
<div class="tile co2-tile" id="co2-tile" onclick="dodiTip('co2')">
  <div class="co2-header">
    <div>
      <div class="co2-label">CO2</div>
      <div class="co2-value"><span id="co2">--</span></div>
      <div class="co2-unit">ppm <span id="co2-sub" class="co2-status" id="co2-status"></span></div>
    </div>
    <div class="co2-badge" id="co2-badge">GOOD</div>
  </div>
  <svg id="chart" class="co2-chart-mini" viewBox="0 0 600 80" preserveAspectRatio="none"></svg>
</div>
<div class="row">
  <div class="tile metric-tile temp-tile" id="temp-tile" onclick="toggleSetpoint();dodiTip('temp')">
    <div class="metric-label">TEMP <span class="setpoint-chev" id="setpoint-chev">&#9662;</span></div>
    <div class="metric-value"><span id="tempIn">--</span>&deg;F</div>
    <div class="setpoint-pop" id="setpoint-pop">
      <div class="setpoint-pop-label">Cooling setpoint</div>
      <div class="setpoint-row">
        <button class="setpoint-btn" onclick="event.stopPropagation();adjustSetpoint(-1)">&minus;</button>
        <div class="setpoint-value"><span id="setpoint-val">75</span>&deg;F</div>
        <button class="setpoint-btn" onclick="event.stopPropagation();adjustSetpoint(1)">+</button>
      </div>
      <div class="setpoint-sub">Fan cools when indoor &gt; setpoint &amp; outdoor is colder</div>
    </div>
  </div>
  <div class="tile metric-tile">
    <div class="metric-label">HUMIDITY</div>
    <div class="metric-value"><span id="humidity">--</span>%</div>
  </div>
</div>
<div class="tile fan-tile idle" id="fan-tile" onclick="dodiTip('fan')">
  <div class="fan-status">
    <div class="fan-state" id="fan-state">FAN IDLE</div>
    <div class="fan-duty"><span id="fan-duty">0%</span><span class="fan-duty-suffix">duty</span></div>
    <div class="fan-reason" id="fan-reason">&nbsp;</div>
  </div>
  <div class="fan-icon-wrap">
    <svg class="fan-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="3" fill="currentColor"/>
      <ellipse cx="16" cy="7" rx="2.5" ry="6" fill="currentColor" opacity="0.9"/>
      <ellipse cx="25" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9"/>
      <ellipse cx="16" cy="25" rx="2.5" ry="6" fill="currentColor" opacity="0.9"/>
      <ellipse cx="7" cy="16" rx="6" ry="2.5" fill="currentColor" opacity="0.9"/>
    </svg>
  </div>
</div>
<div class="tile insight-tile always-on" id="insight-tile" onclick="dodiTip('insight')">
  <div class="insight-header">
    <span class="insight-dot"></span>
    <span class="insight-badge">DODI &middot; ON-DEVICE</span>
    <span class="insight-status" id="insight-status" data-state="init">INIT</span>
    <span class="insight-latency" id="insight-latency"></span>
  </div>
  <div class="insight-text" id="insight-text">Just settling in. Let me get a read on the room...</div>
</div>
</div><!-- /view-live -->
<div class="view" id="view-trend">
  <div class="tile">
    <div class="metric-label" style="margin-bottom:6px;">CO&#8322; &mdash; recent history</div>
    <svg id="trend-chart" viewBox="0 0 600 240" preserveAspectRatio="none"></svg>
    <div class="trend-cap">Live samples &middot; shaded bands = ASHRAE zones (800 / 1000 ppm)</div>
  </div>
</div>
<div class="view" id="view-controls">
<div class="tile manual-tile" id="manual-tile" onclick="toggleManual();dodiTip('manual')">
  <div class="metric-label" style="margin-bottom:10px;">Manual Override <span class="setpoint-chev" id="manual-chev">&#9662;</span></div>
  <div class="controls">
    <button data-mode="auto" class="active" onclick="event.stopPropagation();setMode('auto')">Auto</button>
    <button data-mode="on" onclick="event.stopPropagation();setMode('on')">On</button>
    <button data-mode="off" onclick="event.stopPropagation();setMode('off')">Off</button>
  </div>
  <div class="manual-pop" id="manual-pop">
    <div class="duty-row">
      <div class="duty-label">Manual fan speed <span id="duty-val">100</span>%</div>
      <input type="range" id="duty-slider" class="duty-slider" min="0" max="100" step="5" value="100"
             onclick="event.stopPropagation()"
             oninput="event.stopPropagation();onDutySlide(this.value)"
             onchange="event.stopPropagation();onDutyCommit(this.value)">
      <div class="duty-sub">Active when override is ON</div>
    </div>
  </div>
</div>
<div class="tile tile-sheets">
  <div class="metric-label" style="margin-bottom:10px;">Sheets Logging</div>
  <div class="log-row" id="log-idle">
    <input class="log-input" type="text" id="log-label" placeholder="run label (e.g. dorm_baseline)">
    <button class="log-btn" onclick="startLog()">Start</button>
  </div>
  <div class="log-active" id="log-active">
    <div class="log-active-info">
      <div class="log-active-label" id="log-active-label">--</div>
      <div class="log-active-rows"><span id="log-rows">0</span> rows</div>
    </div>
    <button class="log-btn stop" onclick="stopLog()">Stop</button>
  </div>
</div>
</div><!-- /view-controls -->
<script>
const USE_MOCK=location.search.includes('mock=1');
const IS_CONTROLLER=location.search.includes('ctl=1');
if(!IS_CONTROLLER)document.body.classList.add('viewer');
if(location.search.includes('demo'))document.body.classList.add('demo-mode');
const DATA_URL=USE_MOCK?'/mock-data.json':'/data';
const HIST_URL=USE_MOCK?'/mock-history.json':'/history';
/* --- sidebar nav + views (F1) --- */
function toggleNav(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('scrim').classList.toggle('open');}
function showView(v){
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+v));
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===v));
  toggleNav();
  if(v==='trend')refreshHistory();
}
/* --- dodi tip bubbles (N1) --- */
const DODI_TIPS={
  co2:"The CO₂ you're breathing back in. Past 1,000 ppm your focus quietly drops. I watch it so you don't have to.",
  temp:"Inside versus outside. When it's cooler out there, that's my cue to pull fresh air in.",
  fan:"How hard I'm running the fan, 0 to 100%. I only spin up when it'll actually help — no wasted noise.",
  insight:"This is me, thinking. I read the room every few seconds and say what I'd do and why — all on the chip, no server.",
  manual:"Auto means I'm driving. Switch to manual to take the wheel — set a target and I'll hold it."
};
let _bubbleTimer=null;
function dodiTip(key){
  const b=document.getElementById('dodi-bubble');if(!b||!DODI_TIPS[key])return;
  b.textContent=DODI_TIPS[key];b.classList.add('show');
  clearTimeout(_bubbleTimer);_bubbleTimer=setTimeout(()=>b.classList.remove('show'),5200);
}
/* --- trend view chart (F3) — larger version of the live sparkline --- */
function renderTrendChart(samples){
  if(!samples||samples.length<2)return;
  const W=600,H=240,padL=34,padB=16;
  const maxCo2=Math.max(1200,...samples.map(s=>s.co2)),minCo2=400;
  const tMin=samples[0].t,tMax=samples[samples.length-1].t,tRange=tMax-tMin||1;
  const x=t=>padL+((t-tMin)/tRange)*(W-padL);
  const y=ppm=>(H-padB)-((ppm-minCo2)/(maxCo2-minCo2))*(H-padB);
  const yRed=y(1000),yAmber=y(800);let s='';
  s+=`<rect x="${padL}" y="0" width="${W-padL}" height="${yRed}" fill="#ffebee" opacity="0.6"/>`;
  s+=`<rect x="${padL}" y="${yRed}" width="${W-padL}" height="${yAmber-yRed}" fill="#fff7e0" opacity="0.6"/>`;
  s+=`<rect x="${padL}" y="${yAmber}" width="${W-padL}" height="${(H-padB)-yAmber}" fill="#e8f5e9" opacity="0.6"/>`;
  s+=`<line x1="${padL}" y1="${yRed}" x2="${W}" y2="${yRed}" stroke="#c62828" stroke-dasharray="4 4" opacity="0.5"/>`;
  s+=`<line x1="${padL}" y1="${yAmber}" x2="${W}" y2="${yAmber}" stroke="#b87900" stroke-dasharray="4 4" opacity="0.5"/>`;
  s+=`<text x="2" y="${yRed+4}" font-size="13" fill="#5e6b5e">1000</text>`;
  s+=`<text x="6" y="${yAmber+4}" font-size="13" fill="#5e6b5e">800</text>`;
  const pts=samples.map(p=>`${x(p.t).toFixed(1)},${y(p.co2).toFixed(1)}`).join(' ');
  s+=`<polyline points="${pts}" fill="none" stroke="#1e6e3a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const last=samples[samples.length-1];
  s+=`<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.co2).toFixed(1)}" r="5" fill="#1e6e3a"/>`;
  document.getElementById('trend-chart').innerHTML=s;
}
let _lastTier='green';
function tier(ppm){
  // Hysteresis (20 ppm on downward edges) — prevents UI flicker when CO2 jitters near thresholds.
  if(_lastTier==='green'){if(ppm>=1000)_lastTier='red';else if(ppm>=800)_lastTier='amber';}
  else if(_lastTier==='amber'){if(ppm>=1000)_lastTier='red';else if(ppm<780)_lastTier='green';}
  else{if(ppm<980)_lastTier='amber';}
  return _lastTier;
}
function tierLabel(t){return t==='red'?'Elevated - flush recommended':t==='amber'?'Approaching threshold':'Healthy';}
async function refreshData(){
  try{const r=await fetch(DATA_URL);const d=await r.json();
    document.getElementById('co2').textContent=d.co2;
    const tt=tier(d.co2);
    const tile=document.getElementById('co2-tile');tile.classList.remove('green','amber','red');tile.classList.add(tt);
    const badge=document.getElementById('co2-badge');badge.textContent={green:'GOOD',amber:'AMBER',red:'HIGH'}[tt];badge.classList.remove('green','amber','red');badge.classList.add(tt);
    document.getElementById('co2-sub').textContent=tt==='red'?'· over ASHRAE 1,000':'';
    const calloutText={green:{label:'AIR IS FRESH',title:'Dodi is happy',sub:'Air quality is great'},amber:{label:'AIR IS GETTING STUFFY',title:'Dodi is concerned',sub:'Crack a window soon'},red:{label:'AIR IS STUFFY',title:'Dodi is uncomfortable',sub:'Opening the window will help'}}[tt];
    const callout=document.getElementById('dodi-callout');callout.classList.remove('green','amber','red');callout.classList.add(tt);
    document.getElementById('dodi-label').textContent=calloutText.label;
    document.getElementById('dodi-title').textContent=calloutText.title;
    document.getElementById('dodi-sub').textContent=calloutText.sub;
    if(tt!==lastDodiState){lastDodiState=tt;if(IS_CONTROLLER)getInsight(true);}
    document.getElementById('tempIn').textContent=(d.tempIn*9/5+32).toFixed(1);
    document.getElementById('humidity').textContent=d.humidity.toFixed(0);
    document.getElementById('outdoor-banner').classList.toggle('visible',d.tempOutValid===false);
    if(typeof d.setpointF==='number'){document.getElementById('setpoint-val').textContent=Math.round(d.setpointF);}
    if(typeof d.manualDutyPct==='number' && !dutyDragging){
      document.getElementById('duty-slider').value=d.manualDutyPct;
      document.getElementById('duty-val').textContent=d.manualDutyPct;
    }
    if(!IS_CONTROLLER && typeof d.insightText==='string' && d.insightText.length>0){
      document.getElementById('insight-text').textContent=d.insightText;
    }
    if(typeof d.insightSource==='string'){
      const st=document.getElementById('insight-status');
      const label={live:'LIVE',fallback:'OFFLINE',init:'INIT'}[d.insightSource]||d.insightSource.toUpperCase();
      st.textContent=label;st.setAttribute('data-state',d.insightSource);
    }
    const fs=document.getElementById('fan-state');fs.textContent=d.fanOn?'FAN RUNNING':'FAN IDLE';
    const fanTile=document.getElementById('fan-tile');fanTile.classList.toggle('running',!!d.fanOn);fanTile.classList.toggle('idle',!d.fanOn);
    const dutyPct=Math.round((d.duty||0)/255*100);
    fanTile.style.setProperty('--fan-spin-dur',(0.5+(1-dutyPct/100)*2.5).toFixed(2)+'s');
    document.getElementById('fan-reason').textContent=d.fanOn?d.reason:'';
    document.getElementById('fan-duty').textContent=dutyPct+'%';
    const dodoPx=document.getElementById('dodo-pixel-v2');
    if(dodoPx){
      const stateMap={green:'calm',amber:'alert',red:'distress'};
      dodoPx.classList.remove('calm','alert','distress');dodoPx.classList.add(stateMap[tt]);
      dodoPx.classList.toggle('flapping',!!d.fanOn);
    }
    const logIdle=document.getElementById('log-idle');const logActive=document.getElementById('log-active');
    if(d.logEnabled){
      logIdle.style.display='none';logActive.classList.add('visible');
      document.getElementById('log-active-label').textContent=d.runLabel||'unlabeled';
      document.getElementById('log-rows').textContent=d.logRowCount||0;
    }else{
      logIdle.style.display='flex';logActive.classList.remove('visible');
    }
  }catch(e){}
}
async function refreshHistory(){
  try{const r=await fetch(HIST_URL);const d=await r.json();renderChart(d.samples);renderTrendChart(d.samples);}catch(e){}
}
function renderChart(samples){
  if(!samples||samples.length<2)return;
  const W=600,H=80;
  const maxCo2=Math.max(1200,...samples.map(s=>s.co2));
  const minCo2=400;
  const tMin=samples[0].t,tMax=samples[samples.length-1].t;
  const tRange=tMax-tMin||1;
  const x=t=>((t-tMin)/tRange)*W;
  const y=ppm=>H-((ppm-minCo2)/(maxCo2-minCo2))*H;
  const yRed=y(1000),yAmber=y(800);
  let s='';
  s+=`<rect x="0" y="0" width="${W}" height="${yRed}" fill="#ffebee" opacity="0.7"/>`;
  s+=`<rect x="0" y="${yRed}" width="${W}" height="${yAmber-yRed}" fill="#fff7e0" opacity="0.7"/>`;
  s+=`<rect x="0" y="${yAmber}" width="${W}" height="${H-yAmber}" fill="#e8f5e9" opacity="0.7"/>`;
  s+=`<line x1="0" y1="${yRed}" x2="${W}" y2="${yRed}" stroke="#c62828" stroke-dasharray="4 4" opacity="0.5"/>`;
  s+=`<line x1="0" y1="${yAmber}" x2="${W}" y2="${yAmber}" stroke="#b87900" stroke-dasharray="4 4" opacity="0.5"/>`;
  s+=`<text x="4" y="${y(1000)-3}" font-size="14" font-weight="600" fill="#5e6b5e">1000</text>`;
  s+=`<text x="4" y="${y(800)+14}" font-size="14" font-weight="600" fill="#5e6b5e">800</text>`;
  const pts=samples.map(p=>`${x(p.t).toFixed(1)},${y(p.co2).toFixed(1)}`).join(' ');
  s+=`<polyline points="${pts}" fill="none" stroke="#1e6e3a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const last=samples[samples.length-1];
  s+=`<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.co2).toFixed(1)}" r="5" fill="#1e6e3a"/>`;
  document.getElementById('chart').innerHTML=s;
}
async function setMode(mode){
  if(!IS_CONTROLLER)return;  // viewer guard — UI is hidden but belt-and-suspenders
  document.querySelectorAll('.controls button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if(USE_MOCK)return;
  try{await fetch('/control?mode='+mode,{method:'POST'});refreshData();}catch(e){}
}
let dutyDragging=false;
let dutyCommitTimer=null;
function onDutySlide(v){
  dutyDragging=true;
  document.getElementById('duty-val').textContent=v;
}
function onDutyCommit(v){
  dutyDragging=false;
  if(!IS_CONTROLLER||USE_MOCK)return;
  clearTimeout(dutyCommitTimer);
  dutyCommitTimer=setTimeout(()=>{
    fetch('/control?duty='+v,{method:'POST'}).catch(e=>{});
  },120);
}
function toggleSetpoint(){
  if(!IS_CONTROLLER)return;
  document.getElementById('temp-tile').classList.toggle('expanded');
}
function toggleManual(){
  if(!IS_CONTROLLER)return;
  document.getElementById('manual-tile').classList.toggle('expanded');
}
async function adjustSetpoint(delta){
  if(!IS_CONTROLLER)return;
  const el=document.getElementById('setpoint-val');
  let v=parseInt(el.textContent,10);if(isNaN(v))v=75;
  v=Math.max(60,Math.min(90,v+delta));
  el.textContent=v;  // optimistic UI
  if(USE_MOCK)return;
  try{await fetch('/control?setpoint='+v,{method:'POST'});refreshData();}catch(e){}
}
let lastInsightAt=0;
let lastDodiState='';
let insightInFlight=false;
async function getInsight(force){
  const now=Date.now();
  if(!force&&(now-lastInsightAt<25000))return;
  if(insightInFlight)return;  // single-flight: don't race the firmware into 429s
  insightInFlight=true;
  lastInsightAt=now;
  const t0=performance.now();
  try{
    const r=await fetch(USE_MOCK?'/mock-insight.json':'/insight',{method:'POST'});
    if(r.status===429){return;}  // queued elsewhere — leave 'Thinking...' visible
    const d=await r.json();
    document.getElementById('insight-text').textContent=d.text;
    const ms=Math.round(performance.now()-t0);
    document.getElementById('insight-latency').textContent=ms+' ms';
  }catch(e){
    document.getElementById('insight-text').textContent='Insight unavailable right now.';
  }finally{
    insightInFlight=false;
  }
}
async function startLog(){
  const label=document.getElementById('log-label').value||'unlabeled';
  if(USE_MOCK){alert('Logging is a live-device feature.');return;}
  try{await fetch('/log/start?label='+encodeURIComponent(label));refreshData();}catch(e){}
}
async function stopLog(){
  if(USE_MOCK)return;
  try{await fetch('/log/stop');refreshData();}catch(e){}
}
refreshData();refreshHistory();
if(IS_CONTROLLER){
  getInsight(true);  // controller-only page-load fetch (prevents N-judges × Anthropic-calls on booth load)
  document.getElementById('insight-tile').addEventListener('click',()=>{
    document.getElementById('insight-text').textContent='Thinking...';
    getInsight(true);
  });
}
setInterval(refreshData,1000);
setInterval(refreshHistory,10000);
function initDodiTimelines(){
  const dodi=document.getElementById('dodo-pixel-v2');
  if(!dodi)return;
  const body=dodi.querySelector('.body-group');
  const wUL=dodi.querySelector('.wing-up-l'),wUR=dodi.querySelector('.wing-up-r');
  const wDL=dodi.querySelector('.wing-down-l'),wDR=dodi.querySelector('.wing-down-r');
  if(body)gsap.to(body,{y:-1,duration:1.25,yoyo:true,repeat:-1,ease:'sine.inOut'});
  let flapTl=null,shakeTl=null,up=false;
  function setWings(showUp){
    if(!wUL||!wUR||!wDL||!wDR)return;
    wUL.style.display=showUp?'block':'';
    wUR.style.display=showUp?'block':'';
    wDL.style.display=showUp?'none':'';
    wDR.style.display=showUp?'none':'';
  }
  function startFlap(){if(flapTl)return;flapTl=gsap.to({},{duration:0.09,repeat:-1,onRepeat:()=>{up=!up;setWings(up);}});}
  function stopFlap(){if(!flapTl)return;flapTl.kill();flapTl=null;up=false;setWings(false);}
  function startShake(){if(shakeTl||!body)return;shakeTl=gsap.to(body,{x:0.4,duration:0.07,yoyo:true,repeat:-1,ease:'sine.inOut'});}
  function stopShake(){if(!shakeTl)return;shakeTl.kill();shakeTl=null;if(body)gsap.set(body,{x:0});}
  function sync(){
    dodi.classList.contains('flapping')?startFlap():stopFlap();
    dodi.classList.contains('distress')?startShake():stopShake();
  }
  new MutationObserver(sync).observe(dodi,{attributes:true,attributeFilter:['class']});
  sync();
}
function initDodiV2LookAround(){
  const dodi=document.getElementById('dodo-pixel-v2');
  if(!dodi)return;
  const dirs=['','facing-right','','facing-left'];
  const durs=[4,2,4,2];
  let idx=0,cycler=null,paused=false;
  function step(){
    if(paused)return;
    dodi.classList.remove('facing-right','facing-left');
    if(dirs[idx])dodi.classList.add(dirs[idx]);
    const d=durs[idx];
    idx=(idx+1)%dirs.length;
    cycler=gsap.delayedCall(d,step);
  }
  function sync(){
    const shouldPause=dodi.classList.contains('distress')||dodi.classList.contains('alert');
    if(shouldPause&&!paused){
      paused=true;
      if(cycler)cycler.kill();
      dodi.classList.remove('facing-right','facing-left');
    }else if(!shouldPause&&paused){
      paused=false;
      idx=0;
      step();
    }
  }
  new MutationObserver(sync).observe(dodi,{attributes:true,attributeFilter:['class']});
  step();
}
window.addEventListener('load',()=>{
  if(typeof gsap==='undefined'){console.warn('[Dodi] GSAP unavailable — pixel-art Dodi in static mode');return;}
  if(typeof initDodiTimelines==='function'){initDodiTimelines();}
  if(typeof initDodiV2LookAround==='function'){initDodiV2LookAround();}
});
</script>
</body></html>)raw";

void setupServer() {
    // Root "/" and static assets are now served from LittleFS (the built React app in
    // firmware/data/) via serveStatic registered at the end of this function. The legacy
    // embedded INDEX_HTML page is kept in-source but no longer registered — to fall back
    // to it, re-add this handler and remove the serveStatic line below (or flash `main`).

    server.on("/data", HTTP_GET, [](AsyncWebServerRequest *req) {
        String json = "{";
        json += "\"co2\":"      + String(readings.co2)           + ",";
        json += "\"tempIn\":"   + String(readings.tempIn, 2)     + ",";
        json += "\"humidity\":" + String(readings.humidity, 2)   + ",";
        json += "\"tempOut\":"      + String(readings.tempOut, 2)    + ",";
        json += "\"tempOutValid\":" + String(readings.tempOutValid ? "true" : "false") + ",";
        json += "\"setpointF\":"    + String(coolingSetpointC * 9.0f / 5.0f + 32.0f, 1) + ",";
        json += "\"manualDutyPct\":"+ String((int)((manualDuty * 100) / 255)) + ",";
        json += "\"insightText\":\""+ jsonEscape(cachedInsightText) + "\",";
        json += "\"insightTs\":\""  + String(cachedInsightTs) + "\",";
        json += "\"insightSource\":\""+ cachedInsightSource + "\",";
        json += "\"fanOn\":"    + String(fan.on ? "true" : "false") + ",";
        json += "\"reason\":\"" + String(reasonStr(fan.reason))  + "\",";
        json += "\"duty\":"     + String(computeDuty(fan, readings)) + ",";
        json += "\"logEnabled\":"  + String(logEnabled ? "true" : "false") + ",";
        json += "\"runLabel\":\""  + String(runLabel) + "\",";
        json += "\"logRowCount\":" + String(logRowCount);
        json += "}";
        req->send(200, "application/json", json);
    });

    server.on("/log/start", HTTP_GET, [](AsyncWebServerRequest *req) {
        const char *label = req->hasParam("label")
            ? req->getParam("label")->value().c_str() : nullptr;
        applyLogCommand(true, label, true);   // persists to NVS (reboot-resume)
        req->send(200, "application/json", "{\"ok\":true,\"enabled\":true}");
    });

    server.on("/log/stop", HTTP_GET, [](AsyncWebServerRequest *req) {
        applyLogCommand(false, nullptr, false);
        req->send(200, "application/json", "{\"ok\":true,\"enabled\":false}");
    });

    server.on("/outdoor", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (req->hasParam("temp_c")) {
            tempOutWireless   = req->getParam("temp_c")->value().toFloat();
            lastOutdoorPostMs = millis();
            Serial.printf("Outdoor node: %.2f C\n", tempOutWireless);
        }
        req->send(200, "text/plain", "OK");
    });

    server.on("/history", HTTP_GET, [](AsyncWebServerRequest *req) {
        String json = "{\"interval_ms\":" + String(INTERVAL_SCD40) + ",\"samples\":[";
        uint8_t count = historyFull ? HISTORY_SIZE : historyHead;
        uint8_t start = historyFull ? historyHead : 0;
        unsigned long now = millis();
        bool first = true;
        for (uint8_t i = 0; i < count; i++) {
            uint8_t idx = (start + i) % HISTORY_SIZE;
            const HistorySample &s = history[idx];
            long t_rel = (long)((s.t_ms - now) / 1000);  // seconds before now (negative for past)
            if (!first) json += ",";
            first = false;
            json += "{\"t\":"        + String(t_rel)
                  + ",\"co2\":"      + String(s.co2)
                  + ",\"tempIn\":"   + String(s.tempIn, 1)
                  + ",\"humidity\":" + String(s.humidity, 0)
                  + ",\"tempOut\":"  + String(s.tempOut, 1)
                  + ",\"fanOn\":"    + String(s.fanOn ? "true" : "false")
                  + "}";
        }
        json += "]}";
        req->send(200, "application/json", json);
    });

    server.on("/control", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (req->hasParam("mode")) {
            String m = req->getParam("mode")->value();
            if (m == "auto")      override_mode = OVR_AUTO;
            else if (m == "on")   override_mode = OVR_ON;
            else if (m == "off")  override_mode = OVR_OFF;
        }
        if (req->hasParam("setpoint")) {
            float f = req->getParam("setpoint")->value().toFloat();
            if (f >= SETPOINT_MIN_F && f <= SETPOINT_MAX_F) {
                coolingSetpointC = (f - 32.0f) * 5.0f / 9.0f;
                Serial.printf("[setpoint] %.1fF (%.2fC)\n", f, coolingSetpointC);
            }
        }
        if (req->hasParam("duty")) {
            int pct = req->getParam("duty")->value().toInt();
            if (pct < 0) pct = 0; if (pct > 100) pct = 100;
            manualDuty = (uint8_t)((pct * 255) / 100);
            Serial.printf("[manualDuty] %d%% (raw %u)\n", pct, manualDuty);
        }
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // Synchronous: do the Anthropic call inline. Blocks the AsyncTCP task for
    // 2-3s, which briefly pauses /data polling — acceptable for booth demo and
    // far more reliable than the previous stash-pointer-and-send-later pattern
    // (which dropped TCP responses when the connection went idle during the call).
    server.on("/insight", HTTP_POST, [](AsyncWebServerRequest *req) {
        Serial.println("[insight] handling (sync)");
        String source;
        String text = callAnthropic(source);
        struct tm t;
        if (getLocalTime(&t)) strftime(cachedInsightTs, sizeof(cachedInsightTs), "%Y-%m-%dT%H:%M:%S", &t);
        cachedInsightText   = text;
        cachedInsightSource = source;
        String json = "{\"text\":\"" + jsonEscape(text)
                    + "\",\"generated_at\":\"" + String(cachedInsightTs)
                    + "\",\"source\":\"" + source + "\"}";
        req->send(200, "application/json", json);
        Serial.printf("[insight] sent (source=%s, %u bytes)\n", source.c_str(), json.length());
    });
    // Read-only cache lookup for viewer clients (no Anthropic call, no rate-limit cost).
    server.on("/insight", HTTP_GET, [](AsyncWebServerRequest *req) {
        String json = "{\"text\":\"" + jsonEscape(cachedInsightText)
                    + "\",\"generated_at\":\"" + String(cachedInsightTs)
                    + "\",\"source\":\"" + cachedInsightSource + "\"}";
        req->send(200, "application/json", json);
    });

    // Serve the built React app from LittleFS. Registered LAST so all JSON API routes
    // above take precedence; this catch-all handles "/", /assets/*, and /mock-*.json.
    server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    server.begin();
}

// Periodic + boot auto-regen of the insight cache. Keeps viewer dashboards
// fresh even with no controller tapping. Blocks loop() ~2-3s per call.
void maybeAutoInsight(unsigned long now) {
    if (!readings.valid || WiFi.status() != WL_CONNECTED) return;
    if (firstValidReadingMs == 0) firstValidReadingMs = now;

    bool bootDue = !autoInsightBootDone && (now - firstValidReadingMs >= AUTO_INSIGHT_BOOT_DELAY_MS);
    bool periodicDue = autoInsightBootDone && (now - lastAutoInsightMs >= AUTO_INSIGHT_INTERVAL_MS);
    if (!bootDue && !periodicDue) return;

    Serial.println(bootDue ? "[insight] auto-trigger (boot)" : "[insight] auto-trigger (periodic)");
    String source;
    String text = callAnthropic(source);
    struct tm t;
    if (getLocalTime(&t)) strftime(cachedInsightTs, sizeof(cachedInsightTs), "%Y-%m-%dT%H:%M:%S", &t);
    cachedInsightText   = text;
    cachedInsightSource = source;
    lastAutoInsightMs   = millis();  // refresh after the 2-3s blocking call
    autoInsightBootDone = true;
    Serial.printf("[insight] auto-cached (source=%s)\n", source.c_str());
}

// ── Setup ─────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    pinMode(PIN_RELAY,      OUTPUT);
    // R and G use LEDC channels 2 + 3 (timer 1) — keep clear of channel 0
    // which the fan PWM owns (timer 0). Do NOT call pinMode on R/G, it
    // can leave the pin mux stuck in digital mode and ignore ledcAttachPin.
    ledcSetup(2, 5000, 8); ledcAttachPin(PIN_LED_R, 2); ledcWrite(2, 0);
    ledcSetup(3, 5000, 8); ledcAttachPin(PIN_LED_G, 3); ledcWrite(3, 0);
    pinMode(PIN_LED_B,      OUTPUT);
    pinMode(PIN_SWITCH_ON,  INPUT_PULLUP);
    pinMode(PIN_FAN_TACH,   INPUT);  // ext 10kΩ pull-up provides logic high

    digitalWrite(PIN_RELAY,  RELAY_OFF);
    digitalWrite(PIN_LED_B,  LOW);

    // Fan PWM — Noctua 4-pin native 25 kHz input
    ledcSetup(FAN_PWM_CHANNEL, FAN_PWM_FREQ, FAN_PWM_RES_BITS);
    ledcAttachPin(PIN_FAN_PWM, FAN_PWM_CHANNEL);
    ledcWrite(FAN_PWM_CHANNEL, 0);

    Wire.begin(PIN_SDA, PIN_SCL);

    Serial.println("I2C scan:");
    for (byte addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("  found device at 0x%02X\n", addr);
        }
    }
    // Reset I2C bus after scan — ESP32 NAK flood can leave SDA stuck
    Wire.end();
    delay(10);
    Wire.begin(PIN_SDA, PIN_SCL);

    delay(2000);  // SCD40 power-on max is 1000ms; 2000ms gives margin

    // OLED probe + init before SCD40 — oled.begin() drives Wire.write() calls that prime
    // the ESP32 Wire TX buffer; a bare probe (no write) is not sufficient
    Wire.beginTransmission(OLED_ADDR);
    oledOk = (Wire.endTransmission() == 0);
    Serial.printf("OLED probe: %s\n", oledOk ? "found" : "not found");
    if (oledOk && !oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
        oledOk = false;
        Serial.println("OLED init failed");
    }
    if (!oledOk) {
        // No OLED writes happened — prime Wire TX path manually before SCD40
        Wire.beginTransmission(OLED_ADDR); Wire.write(0); Wire.endTransmission();
    }

    // SCD40 — Wire TX path is now primed
    scd40.begin(Wire, 0x62);
    uint16_t stopErr = scd40.stopPeriodicMeasurement();
    if (stopErr) {
        // stop failed — re-prime Wire TX and retry
        Wire.end(); delay(50); Wire.begin(PIN_SDA, PIN_SCL);
        Wire.beginTransmission(OLED_ADDR); Wire.write(0x00); Wire.write(0xE3); Wire.endTransmission();
        scd40.stopPeriodicMeasurement();
    }
    // stopPeriodicMeasurement() has 500ms internal delay — Wire TX de-primes during it; re-prime before start
    Wire.beginTransmission(OLED_ADDR); Wire.write(0x00); Wire.write(0xE3); Wire.endTransmission();
    scd40.startPeriodicMeasurement();

    if (oledOk) {
        oled.clearDisplay();
        oled.setTextColor(SSD1306_WHITE);
        oled.setCursor(0, 0);
        oled.println("Ventis v1");
        oled.println("Starting...");
        oled.display();
    }

    // DS18B20
    ds18b20.begin();
    Serial.printf("DS18B20 devices found: %d\n", ds18b20.getDeviceCount());

    // WiFi
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

    // NTP time sync (needed for log timestamps)
    configTime(-4 * 3600, 3600, "pool.ntp.org");  // ET: UTC-4 summer, +1hr DST
    struct tm t;
    int ntpTries = 0;
    while (!getLocalTime(&t) && ntpTries++ < 20) delay(500);
    Serial.printf("NTP: %s\n", ntpTries < 20 ? "synced" : "failed");

    // Restore logging state across reboots — a crash/power-blip resumes the run
    // instead of going silent. Also restore the last applied remote command id.
    prefs.begin("ventis", false);
    logEnabled  = prefs.getBool("logOn", false);
    lastCtrlSeq = prefs.getUInt("ctrlSeq", 0);
    String savedLabel = prefs.getString("label", "");
    if (savedLabel.length()) {
        strncpy(runLabel, savedLabel.c_str(), sizeof(runLabel) - 1);
        runLabel[sizeof(runLabel) - 1] = '\0';
    }
    String savedRunId = prefs.getString("runId", "");
    if (savedRunId.length()) {
        strncpy(runId, savedRunId.c_str(), sizeof(runId) - 1);
        runId[sizeof(runId) - 1] = '\0';
    }
    if (logEnabled) {
        lastLogMs = 0;   // resume logging immediately
        Serial.printf("[RESUME] logging '%s' after reboot\n", runLabel);
    }

    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("AP started: %s\n", WiFi.softAPIP().toString().c_str());

    if (!LittleFS.begin(true)) {
        Serial.println("LittleFS mount FAILED — React UI will 404 (JSON API still works)");
    } else {
        Serial.println("LittleFS mounted — serving React app from /data");
    }

    setupServer();
    if (oledOk) updateOled();
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
    unsigned long now = millis();

    // Read SCD40
    if (now - lastScd40Read >= INTERVAL_SCD40) {
        lastScd40Read = now;
        uint16_t co2;
        float    temp, hum;
        bool     dataReady = false;

        scd40.getDataReadyStatus(dataReady);
        if (dataReady) {
            uint16_t err = scd40.readMeasurement(co2, temp, hum);
            if (err == 0) {
                readings.co2      = co2;
                readings.tempIn   = temp;
                readings.humidity = hum;
                readings.valid    = true;
            }
        }
    }

    // Read DS18B20 (only if a probe was found at boot — v1 hub has no wired probe)
    if (now - lastDs18b20Read >= INTERVAL_DS18B20 && ds18b20.getDeviceCount() > 0) {
        lastDs18b20Read = now;
        ds18b20.requestTemperatures();
        float t = ds18b20.getTempCByIndex(0);
        if (t != DEVICE_DISCONNECTED_C) {
            tempOutWired      = t;
            tempOutWiredValid = true;
            lastWiredOkMs     = now;
        }
    }

    // Prefer wireless when fresh; fall back to wired if C3 is silent; mark invalid if neither
    bool wirelessFresh = lastOutdoorPostMs > 0 &&
                         (now - lastOutdoorPostMs < OUTDOOR_STALE_MS);
    bool wiredFresh    = tempOutWiredValid &&
                         (now - lastWiredOkMs < OUTDOOR_STALE_MS);
    if (wirelessFresh)   { readings.tempOut = tempOutWireless; readings.tempOutValid = true; }
    else if (wiredFresh) { readings.tempOut = tempOutWired;    readings.tempOutValid = true; }
    else                 { readings.tempOutValid = false; }

    // Control logic — web override > physical switch > auto
    if (override_mode == OVR_ON) {
        fan.on = true;   fan.reason = MANUAL;
    } else if (override_mode == OVR_OFF) {
        fan.on = false;  fan.reason = NONE;
    } else if (readSwitch() == SW_FORCE_ON) {
        fan.on = true;   fan.reason = MANUAL;
    } else {
        fan = evaluateFan(readings);
    }
    setFanOutputs(fan, readings);  // relay = master enable, PWM = variable speed

    // Push to history ring buffer on every SCD40 read (5s cadence)
    static unsigned long lastHistoryPush = 0;
    if (readings.valid && now - lastHistoryPush >= INTERVAL_SCD40) {
        lastHistoryPush = now;
        pushHistory(readings, fan.on);
    }

    // Google Sheets logging
    if (logEnabled && readings.valid && (now - lastLogMs >= LOG_INTERVAL)) {
        lastLogMs = now;
        logToSheets();
        logRowCount++;
    }

    // Remote control poll — outbound HTTPS, so a run can be started/stopped from
    // anywhere (edit the control tab + bump seq). Blocks ~1-2s like logToSheets.
    if (now - lastCtrlPollMs >= CTRL_POLL_INTERVAL) {
        lastCtrlPollMs = now;
        pollControl();
    }

    // RGB LED
    updateLed(readings.co2, readings.valid);

    // OLED redraws on its own cadence (decoupled from SCD40) so fan / state
    // transitions land within 1s on the screen even though sensor data is 5s.
    static unsigned long lastOledUpdate = 0;
    if (now - lastOledUpdate >= INTERVAL_OLED) {
        lastOledUpdate = now;
        updateOled();
    }

    // Auto-regen insight (boot + every 60s). Last in loop iteration so it doesn't
    // delay LED/OLED/control updates above. Blocks loop ~2-3s per fire.
    maybeAutoInsight(now);
}
