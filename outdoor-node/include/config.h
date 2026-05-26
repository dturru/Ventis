#pragma once

#define AP_SSID          "Ventis"
#define AP_PASSWORD      "ventis-outdoor"
#define HUB_IP           "192.168.4.1"
#define PIN_DS18B20      4
#define SLEEP_INTERVAL_S 60     // bump to 30 when on LiPo

// TEMPORARY BENCH-TEST FLAG — set back to 0 before production / battery deployment
//   1 = stay awake, loop measurement every DEBUG_LOOP_MS, NO deep sleep
//   0 = production: one measurement per wake, then deep sleep for SLEEP_INTERVAL_S
#define DEBUG_NO_SLEEP   1
#define DEBUG_LOOP_MS    5000   // cycle period in debug mode (5 sec)
