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
    uint16_t co2        = 0;
    float    tempIn     = 0.0f;   // °C, from SCD40
    float    humidity   = 0.0f;   // %RH
    float    tempOut    = 0.0f;   // °C, from DS18B20
    bool     valid      = false;
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

float         tempOutWired     = 0.0f;   // from wired DS18B20
float         tempOutWireless  = 0.0f;   // from C3 outdoor node
unsigned long lastOutdoorPostMs = 0;      // 0 = never received

bool          oledOk           = false;   // set by probe in setup(); guards all OLED I2C ops
unsigned long lastLogMs        = 0;
bool          logEnabled       = false;
char          runLabel[64]     = "unlabeled";
uint32_t      logRowCount      = 0;

// /insight is deferred from the AsyncWebServer handler to loop() — the HTTPS POST to
// Anthropic takes ~2-3s and would block AsyncTCP's event loop if run inline.
AsyncWebServerRequest* pendingInsightReq = nullptr;

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
    if ((r.tempIn - r.tempOut) > COOLING_DELTA_C) {
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
    if (f.reason == MANUAL) return FAN_DUTY_MAX;
    if (f.reason == CO2_HIGH && r.co2 >= CO2_ALARM_PPM) return FAN_DUTY_MAX;
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
    char body[300];
    snprintf(body, sizeof(body),
        "{\"timestamp\":\"%s\",\"run\":\"%s\",\"co2\":%u,\"temp_in_c\":%.2f,"
        "\"humidity_pct\":%.2f,\"temp_out_c\":%.2f,\"fan_on\":%s,\"reason\":\"%s\"}",
        ts, runLabel, readings.co2, readings.tempIn, readings.humidity, readings.tempOut,
        fan.on ? "true" : "false", reasonStr(fan.reason));
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
    else if (state == 1) {  ledcWrite(2, 60);  ledcWrite(3, 255); }  // amber: balanced R/G
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
    oled.printf("OUT:  %.1fF\n",      toF(readings.tempOut));
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
    String msg = "Now: CO2 " + String(readings.co2) + " ppm, indoor "
               + String(toF(readings.tempIn), 1) + "F / " + String((int)readings.humidity)
               + "% RH, outdoor " + String(toF(readings.tempOut), 1) + "F.\n";

    uint8_t count = historyFull ? HISTORY_SIZE : historyHead;
    if (count >= 2) {
        uint8_t startIdx = historyFull ? historyHead : 0;
        uint8_t lastIdx  = (historyHead == 0 ? HISTORY_SIZE - 1 : historyHead - 1);
        uint16_t startCo2 = history[startIdx].co2;
        uint16_t endCo2   = history[lastIdx].co2;
        const char* dir = (endCo2 > startCo2 + 50) ? "rising"
                        : (endCo2 + 50 < startCo2) ? "falling" : "stable";
        msg += "CO2 last ~5 min: " + String(startCo2) + " -> " + String(endCo2) + " ppm (" + dir + ").\n";
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
    msg += ").";
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
    // System prompt — Dodi persona variant (2026-05-27). Replaces the locked
    // 2026-05-26 third-person 'Ventis' voice. Same sensor-aware constraints.
    // Mirror in dev/test_insight_prompt.py:SYSTEM_PROMPT and Projects/Ventis/AI Insight Prompt.md.
    String body = String("{\"model\":\"") + ANTHROPIC_MODEL + "\","
        + "\"max_tokens\":160,"
        + "\"system\":"
          "\"You are Dodi, the dodo mascot of Ventis — an air-quality monitor in a Dartmouth dorm room. "
          "Given the room's recent sensor data, write a brief first-person note (1-2 short sentences) "
          "the resident would read on their phone. Speak as Dodi: curious, a little anxious about the air, "
          "honest about what you're sensing. Cite specific numbers from the input (CO2 ppm, temp, fan state). "
          "Sound like a small bird narrating the room — not an app handing out advice. "
          "No emoji, no greeting, no bullet list. Stay under 200 characters.\\n"
          "\\n"
          "Rules:\\n"
          "- If CO2 is under 800 ppm and nothing else is notable, just confirm the air feels clean in ONE short sentence. "
          "Do NOT suggest opening windows or taking action when there is no problem.\\n"
          "- Only use trend words ('rising', 'climbing', 'falling') when the input explicitly states a direction. Never invent a trend.\\n"
          "- When the fan is on, name the reason from the input (CO2, COOLING, HUMIDITY). Don't guess a reason that isn't there.\\n"
          "- Lead with the most striking fact (e.g., CO2 hit a new high, fan ramped to 100%, temperature crossed the cooling threshold).\\n"
          "- First-person voice: 'I'm watching...', 'the air's getting heavy', 'I can breathe again'. Never break character to mention sensors or sampling rates.\","
        + "\"messages\":[{\"role\":\"user\",\"content\":\"" + jsonEscape(userMsg) + "\"}]"
        + "}";

    WiFiClientSecure client;
    client.setInsecure();   // demo: skip cert check. For prod, bundle Anthropic root cert.
    HTTPClient http;
    http.setTimeout(15000);
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
</style>
<script defer src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
</head><body>
<header><h1>Ventis</h1><span class="location" id="location">DORM ROOM</span></header>
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
<div class="tile co2-tile" id="co2-tile">
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
  <div class="tile metric-tile">
    <div class="metric-label">TEMP</div>
    <div class="metric-value"><span id="tempIn">--</span>&deg;F</div>
  </div>
  <div class="tile metric-tile">
    <div class="metric-label">HUMIDITY</div>
    <div class="metric-value"><span id="humidity">--</span>%</div>
  </div>
</div>
<div class="tile fan-tile idle" id="fan-tile">
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
<div class="tile insight-tile always-on" id="insight-tile">
  <div class="insight-header">
    <span class="insight-dot"></span>
    <span class="insight-badge">DODI &middot; ON-DEVICE</span>
  </div>
  <div class="insight-text" id="insight-text">Just settling in. Let me get a read on the room...</div>
</div>
<div class="tile">
  <div class="metric-label" style="margin-bottom:10px;">Manual Override</div>
  <div class="controls">
    <button data-mode="auto" class="active" onclick="setMode('auto')">Auto</button>
    <button data-mode="on" onclick="setMode('on')">On</button>
    <button data-mode="off" onclick="setMode('off')">Off</button>
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
<script>
const USE_MOCK=location.search.includes('mock=1');
if(location.search.includes('demo'))document.body.classList.add('demo-mode');
const DATA_URL=USE_MOCK?'/mock-data.json':'/data';
const HIST_URL=USE_MOCK?'/mock-history.json':'/history';
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
    if(tt!==lastDodiState){lastDodiState=tt;getInsight(true);}
    document.getElementById('tempIn').textContent=(d.tempIn*9/5+32).toFixed(1);
    document.getElementById('humidity').textContent=d.humidity.toFixed(0);
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
  try{const r=await fetch(HIST_URL);const d=await r.json();renderChart(d.samples);}catch(e){}
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
  document.querySelectorAll('.controls button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if(USE_MOCK)return;
  try{await fetch('/control?mode='+mode,{method:'POST'});refreshData();}catch(e){}
}
let lastInsightAt=0;
let lastDodiState='';
async function getInsight(force){
  const now=Date.now();
  if(!force&&(now-lastInsightAt<25000))return;
  lastInsightAt=now;
  try{
    const r=await fetch(USE_MOCK?'/mock-insight.json':'/insight',{method:'POST'});
    const d=await r.json();
    document.getElementById('insight-text').textContent=d.text;
  }catch(e){
    document.getElementById('insight-text').textContent='Insight unavailable right now.';
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
getInsight(true);  // explicit page-load fetch (independent of state change)
document.getElementById('insight-tile').addEventListener('click',()=>{
  document.getElementById('insight-text').textContent='Thinking...';
  getInsight(true);
});
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
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
        req->send(200, "text/html", INDEX_HTML);
    });

    server.on("/data", HTTP_GET, [](AsyncWebServerRequest *req) {
        String json = "{";
        json += "\"co2\":"      + String(readings.co2)           + ",";
        json += "\"tempIn\":"   + String(readings.tempIn, 2)     + ",";
        json += "\"humidity\":" + String(readings.humidity, 2)   + ",";
        json += "\"tempOut\":"  + String(readings.tempOut, 2)    + ",";
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
        if (req->hasParam("label")) {
            strncpy(runLabel, req->getParam("label")->value().c_str(), sizeof(runLabel) - 1);
        }
        logEnabled  = true;
        logRowCount = 0;
        lastLogMs   = 0;
        req->send(200, "application/json", "{\"ok\":true,\"enabled\":true}");
    });

    server.on("/log/stop", HTTP_GET, [](AsyncWebServerRequest *req) {
        logEnabled = false;
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
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // Defer to loop() — the Anthropic call takes ~2-3s and would block AsyncTCP.
    // Frontend keeps the connection open; loop() calls req->send() when the API returns.
    server.on("/insight", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (pendingInsightReq != nullptr) {
            // Another insight call is already in flight — refuse politely.
            req->send(429, "application/json",
                "{\"text\":\"Already thinking — try again in a moment.\","
                "\"source\":\"fallback\",\"generated_at\":\"\"}");
            return;
        }
        pendingInsightReq = req;
    });

    server.begin();
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

    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("AP started: %s\n", WiFi.softAPIP().toString().c_str());

    setupServer();
    if (oledOk) updateOled();
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
    unsigned long now = millis();

    // /insight — deferred Anthropic call. Blocks loop() for ~2-3s on a live API call;
    // SCD40 (5s cadence) and the slow DS18B20 read (30s) tolerate this. Watchdog default is 5s.
    if (pendingInsightReq != nullptr) {
        AsyncWebServerRequest* req = pendingInsightReq;
        pendingInsightReq = nullptr;  // clear first — re-entry safe
        String source;
        String text = callAnthropic(source);
        char ts[25] = "now";
        struct tm t;
        if (getLocalTime(&t)) strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &t);
        String json = "{\"text\":\"" + jsonEscape(text)
                    + "\",\"generated_at\":\"" + String(ts)
                    + "\",\"source\":\"" + source + "\"}";
        req->send(200, "application/json", json);
        now = millis();  // refresh — we just spent a few seconds on the API call
    }

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

    // Read DS18B20
    if (now - lastDs18b20Read >= INTERVAL_DS18B20) {
        lastDs18b20Read = now;
        ds18b20.requestTemperatures();
        float t = ds18b20.getTempCByIndex(0);
        if (t != DEVICE_DISCONNECTED_C) {
            tempOutWired = t;
        }
    }

    // Prefer wireless when fresh; fall back to wired if C3 is silent
    bool wirelessFresh = lastOutdoorPostMs > 0 &&
                         (now - lastOutdoorPostMs < OUTDOOR_STALE_MS);
    readings.tempOut = wirelessFresh ? tempOutWireless : tempOutWired;

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

    // RGB LED
    updateLed(readings.co2, readings.valid);

    // OLED redraws on its own cadence (decoupled from SCD40) so fan / state
    // transitions land within 1s on the screen even though sensor data is 5s.
    static unsigned long lastOledUpdate = 0;
    if (now - lastOledUpdate >= INTERVAL_OLED) {
        lastOledUpdate = now;
        updateOled();
    }
}
