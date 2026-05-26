#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "config.h"

OneWire           oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);

void measure_and_post() {
    // Read DS18B20
    ds18b20.requestTemperatures();
    float tempC = ds18b20.getTempCByIndex(0);
    Serial.printf("DS18B20: %.2f C\n", tempC);

    if (tempC == DEVICE_DISCONNECTED_C) {
        Serial.println("DS18B20 disconnected");
#if !DEBUG_NO_SLEEP
        esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_INTERVAL_S * 1000000ULL);
        esp_deep_sleep_start();
#endif
        return;
    }

    // Connect to Ventis AP
    WiFi.begin(AP_SSID, AP_PASSWORD);
    Serial.print("Connecting");
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(500);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nConnected to Ventis AP");
        HTTPClient http;
        String url = "http://";
        url += HUB_IP;
        url += "/outdoor?temp_c=";
        url += String(tempC, 2);
        http.begin(url);
        int code = http.POST("");
        Serial.printf("POST %s → %d\n", url.c_str(), code);
        http.end();
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
    } else {
        Serial.println("\nAP connect failed");
    }
}

void setup() {
    Serial.begin(115200);
    delay(100);
    ds18b20.begin();

#if DEBUG_NO_SLEEP
    Serial.println("=== DEBUG_NO_SLEEP MODE — deep sleep DISABLED ===");
    Serial.printf("Looping every %d ms. Revert by setting DEBUG_NO_SLEEP=0 in config.h.\n", DEBUG_LOOP_MS);
#else
    measure_and_post();
    Serial.printf("Sleeping %ds\n", SLEEP_INTERVAL_S);
    Serial.flush();
    esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_INTERVAL_S * 1000000ULL);
    esp_deep_sleep_start();
#endif
}

void loop() {
#if DEBUG_NO_SLEEP
    measure_and_post();
    Serial.println("---");
    delay(DEBUG_LOOP_MS);
#endif
}
