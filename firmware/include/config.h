#pragma once

// Secrets (WiFi credentials, Anthropic API key) live in secrets.h, which is gitignored.
// Copy secrets.h.example to secrets.h on a fresh clone before building.
#include "secrets.h"

// Pin assignments — core
#define PIN_DS18B20   4     // DS18B20 OneWire data
#define PIN_RELAY     26    // Relay control — switches 12V DC to Noctua (was AC mains pre-2026-05-25)

// Pin assignments — v1 indicators + override
#define PIN_LED_R         19    // RGB LED red channel (common cathode, active HIGH)
#define PIN_LED_G         17    // RGB LED green channel
#define PIN_LED_B         16    // RGB LED blue channel
#define PIN_SWITCH_ON     32    // 2-pos switch: LOW = manual fan ON, HIGH = auto

// Pin assignments — Noctua NF-P12 Redux 1700 PWM (4-pin, 12V, native PWM)
#define PIN_FAN_PWM       25    // PWM out → fan pin 4 (Blue); 25 kHz, 3.3V logic
#define PIN_FAN_TACH      34    // Tach in ← fan pin 3 (Green); ext 10kΩ pull-up to 3.3V (input-only pin, no internal pull-up)

// HiLetgo OPTO relay jumper set to HIGH trigger: HIGH = fan ON, LOW = fan OFF
#define RELAY_ON      HIGH
#define RELAY_OFF     LOW

// Fan PWM (LEDC peripheral)
#define FAN_PWM_CHANNEL   0       // ESP32 LEDC channel
#define FAN_PWM_FREQ      25000   // Hz — Noctua PWM spec
#define FAN_PWM_RES_BITS  8       // → duty range 0-255
#define FAN_DUTY_MID      128     // ~50% — normal active modes (cooling, humidity, CO2 elevated)
#define FAN_DUTY_MAX      255     // 100% — CO2 alarm or manual override

// I2C bus (SCD40 + OLED share the same bus)
#define PIN_SDA       21
#define PIN_SCL       22
#define OLED_ADDR     0x3C
#define OLED_WIDTH    128
#define OLED_HEIGHT   64

// Control thresholds
#define COOLING_DELTA_C    2.8f   // ~5°F — fan ON only if indoor exceeds outdoor by this much (matches Firmware v2 spec; 5°F is the honest floor for felt convective cooling + keeps headroom above the 3°F hysteresis floor)
#define CO2_THRESHOLD      800    // ppm — fan ON above this level
#define CO2_ALARM_PPM      1000   // ppm — red LED alarm
#define HUMIDITY_THRESHOLD 65.0f  // %RH — fan ON above this level

// Sensor read intervals (ms)
#define INTERVAL_SCD40    5000   // SCD40 periodic measurement cadence (hardware floor — NDIR cycle)
#define INTERVAL_DS18B20  10000  // Outdoor temp poll. NOTE: if outdoor node moves to battery, revert to 30000+ to extend C3 runtime.
#define INTERVAL_OLED     1000   // OLED redraw cadence (decoupled from sensor read — repaints cached readings + live state)

// Google Sheets logger
// 2026-06-01: repointed to the v3 schema deployment (writes the locked `telemetry` tab).
// Old per-run-tab deployment was: AKfycbwBiCM6SlmVnw8-vi2htEFvyK16HTt9hWD-U46EZVeYU6-Zm8fLjJlekcMcTeHTh_II
#define SHEETS_URL   "https://script.google.com/macros/s/AKfycbxGhE2Pz5Lp1xlLEwjpfPZI9cyJkNz3nbioRvHkJfGn5dgp94_JDueu67judZPQumFmWQ/exec"
#define RUN_LABEL    "unlabeled"      // change before each run: e.g. "dorm_window_only"
#define LOG_INTERVAL 30000            // ms between log writes (30s matches old Pi logger)

// Ventis AP — private network for outdoor node (AP+STA dual mode)
#define AP_SSID          "Ventis"
#define AP_PASSWORD      "ventis-outdoor"
#define OUTDOOR_STALE_MS 90000   // ms — fall back to wired DS18B20 if C3 silent
