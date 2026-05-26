// Wokwi simulation build — SCD40 stubbed with auto-cycling test values.
// Cycles through all three fan triggers: CO2 ramp → humidity spike → cooling delta → reset.
// DS18B20, OLED, relay LED, and web dashboard all use real implementations.
// WiFi: Wokwi-GUEST (no password).

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_SSD1306.h>
#include <ESPAsyncWebServer.h>

// ── Pin assignments ───────────────────────────────────────────────────────────
#define PIN_DS18B20    4
#define PIN_RELAY      26
#define RELAY_ON       LOW
#define RELAY_OFF      HIGH
#define PIN_SDA        21
#define PIN_SCL        22
#define OLED_ADDR      0x3C
#define OLED_WIDTH     128
#define OLED_HEIGHT    64

// ── Thresholds ────────────────────────────────────────────────────────────────
#define COOLING_DELTA_C    1.7f
#define CO2_THRESHOLD      800
#define HUMIDITY_THRESHOLD 65.0f
#define INTERVAL_DS18B20   30000UL

// ── Hardware ──────────────────────────────────────────────────────────────────
OneWire           oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);
Adafruit_SSD1306  oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
AsyncWebServer    server(80);

// ── State ─────────────────────────────────────────────────────────────────────
struct Readings {
    uint16_t co2      = 600;
    float    tempIn   = 24.0f;
    float    humidity = 50.0f;
    float    tempOut  = 20.0f;
    bool     valid    = true;
} readings;

enum FanReason { NONE, COOLING, CO2_HIGH, HUMIDITY_HIGH };
struct FanState { bool on = false; FanReason reason = NONE; } fan;

unsigned long lastDs18b20Read = 0;
unsigned long lastSimStep     = 0;

// Phase 0: CO2 ramps 600→950 ppm (crosses 800 threshold)
// Phase 1: CO2 drops, humidity ramps 50→75% (crosses 65% threshold)
// Phase 2: humidity drops, indoor temp climbs until delta > 1.7°C
// Phase 3: brief reset, then repeat
int simPhase = 0;

// ── SCD40 stub ────────────────────────────────────────────────────────────────
void stepSimulation() {
    if (millis() - lastSimStep < 2000) return;
    lastSimStep = millis();

    switch (simPhase) {
        case 0:
            readings.co2 += 10;
            readings.humidity = 50.0f;
            readings.tempIn   = 24.0f;
            if (readings.co2 >= 950) { simPhase = 1; readings.co2 = 400; }
            break;
        case 1:
            readings.humidity += 2.0f;
            readings.co2    = 400;
            readings.tempIn = 24.0f;
            if (readings.humidity >= 75.0f) { simPhase = 2; readings.humidity = 50.0f; }
            break;
        case 2:
            readings.tempIn += 0.3f;
            readings.co2      = 400;
            readings.humidity = 50.0f;
            if ((readings.tempIn - readings.tempOut) > COOLING_DELTA_C + 1.5f) {
                simPhase = 3;
            }
            break;
        case 3:
            readings.co2      = 600;
            readings.tempIn   = 24.0f;
            readings.humidity = 50.0f;
            simPhase = 0;
            break;
    }
}

// ── Control logic ─────────────────────────────────────────────────────────────
FanState evaluateFan(const Readings &r) {
    FanState s;
    if (!r.valid) return s;
    if (r.co2 > CO2_THRESHOLD)           { s.on = true; s.reason = CO2_HIGH;      return s; }
    if (r.humidity > HUMIDITY_THRESHOLD)  { s.on = true; s.reason = HUMIDITY_HIGH; return s; }
    if ((r.tempIn - r.tempOut) > COOLING_DELTA_C) { s.on = true; s.reason = COOLING; return s; }
    return s;
}

const char *reasonStr(FanReason r) {
    switch (r) {
        case CO2_HIGH:      return "CO2";
        case HUMIDITY_HIGH: return "HUMIDITY";
        case COOLING:       return "COOLING";
        default:            return "---";
    }
}

// ── OLED ──────────────────────────────────────────────────────────────────────
void updateOled() {
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.printf("CO2:  %4u ppm\n",        readings.co2);
    oled.printf("IN:   %.1fC  %.0f%%\n",  readings.tempIn, readings.humidity);
    oled.printf("OUT:  %.1fC\n",          readings.tempOut);
    oled.printf("FAN:  %s  %s\n",
        fan.on ? "ON " : "OFF",
        fan.on ? reasonStr(fan.reason) : "");
    oled.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    oled.display();
}

// ── Web server ────────────────────────────────────────────────────────────────
void setupServer() {
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
        String phase_name;
        switch (simPhase) {
            case 0: phase_name = "CO2 ramp";       break;
            case 1: phase_name = "Humidity spike";  break;
            case 2: phase_name = "Cooling delta";   break;
            case 3: phase_name = "Reset";           break;
        }
        String html =
            "<!DOCTYPE html><html><head>"
            "<meta charset='utf-8'><meta http-equiv='refresh' content='2'>"
            "<title>Ventis SIM</title>"
            "<style>body{font-family:monospace;padding:20px;background:#111;color:#eee;}"
            "td{padding:4px 12px;} .on{color:#4f4;font-weight:bold;} .off{color:#888;}"
            "h2{color:#4af;}</style></head><body>"
            "<h2>Ventis v1 — Wokwi Sim</h2><table>";
        html += "<tr><td>CO2</td><td>" + String(readings.co2) + " ppm</td></tr>";
        html += "<tr><td>Temp (indoor)</td><td>" + String(readings.tempIn, 1) + " &deg;C</td></tr>";
        html += "<tr><td>Humidity</td><td>" + String(readings.humidity, 1) + " %</td></tr>";
        html += "<tr><td>Temp (outdoor)</td><td>" + String(readings.tempOut, 1) + " &deg;C</td></tr>";
        html += "<tr><td>Fan</td><td class='";
        html += fan.on ? "on'>ON &mdash; " + String(reasonStr(fan.reason)) : "off'>OFF";
        html += "</td></tr>";
        html += "<tr><td>Sim phase</td><td>" + phase_name + "</td></tr>";
        html += "</table></body></html>";
        req->send(200, "text/html", html);
    });

    server.on("/data", HTTP_GET, [](AsyncWebServerRequest *req) {
        String json = "{";
        json += "\"co2\":"      + String(readings.co2)              + ",";
        json += "\"tempIn\":"   + String(readings.tempIn, 2)        + ",";
        json += "\"humidity\":" + String(readings.humidity, 2)      + ",";
        json += "\"tempOut\":"  + String(readings.tempOut, 2)       + ",";
        json += "\"fanOn\":"    + String(fan.on ? "true" : "false") + ",";
        json += "\"reason\":\"" + String(reasonStr(fan.reason))     + "\"";
        json += "}";
        req->send(200, "application/json", json);
    });

    server.begin();
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.println("\nVentis v1 — Wokwi Sim");
    Serial.println("Phases: 0=CO2 ramp  1=Humidity spike  2=Cooling delta  3=Reset");

    pinMode(PIN_RELAY, OUTPUT);
    digitalWrite(PIN_RELAY, RELAY_OFF);

    Wire.begin(PIN_SDA, PIN_SCL);

    if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR))
        Serial.println("OLED init failed");
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.println("Ventis v1 SIM");
    oled.println("Starting...");
    oled.display();

    ds18b20.begin();
    Serial.printf("DS18B20 devices: %d\n", ds18b20.getDeviceCount());

    WiFi.begin("Wokwi-GUEST", "");
    Serial.print("WiFi");
    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < 20) {
        delay(500); Serial.print("."); tries++;
    }
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());
    else
        Serial.println("\nWiFi failed — running offline");

    setupServer();
    updateOled();
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    unsigned long now = millis();

    stepSimulation();

    if (now - lastDs18b20Read >= INTERVAL_DS18B20) {
        lastDs18b20Read = now;
        ds18b20.requestTemperatures();
        float t = ds18b20.getTempCByIndex(0);
        if (t != DEVICE_DISCONNECTED_C) readings.tempOut = t;
    }

    fan = evaluateFan(readings);
    digitalWrite(PIN_RELAY, fan.on ? RELAY_ON : RELAY_OFF);

    updateOled();
    delay(200);
}
