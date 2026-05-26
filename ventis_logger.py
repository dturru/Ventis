"""
Ventis data logger -- CO2 ppm + temperature + humidity, CSV output.
Usage: python3 ventis_logger.py
Ctrl+C to stop.

Sensors:
  CO2  #778 (MH-Z16)                              -> GrovePi UART -> /dev/serial0
  T/RH #656 (Seeed Temp & Humidity Pro v1.0, DHT22) -> GrovePi Digital D4
"""

import serial
import grovepi
import csv
import time
from datetime import datetime
from pathlib import Path

# --- Config ---
CONDITION    = "baseline_empty"   # change before each run: baseline_empty, baseline_occupied,
                                  # window_only, fan_only, fan_low_window, fan_med_window, etc.
DHT_PORT     = 4              # Digital D4 -- update if wired to different port
CO2_SERIAL   = "/dev/serial0"
CO2_BAUD     = 9600
INTERVAL_S   = 30             # seconds between readings
LOG_FILE     = Path("ventis_data.csv")

CO2_CMD = b'\xff\x01\x86\x00\x00\x00\x00\x00\x79'

FIELDS = ["timestamp", "condition", "co2_ppm", "temp_c", "humidity_pct"]


def read_co2(ser):
    ser.write(CO2_CMD)
    time.sleep(0.1)
    resp = ser.read(9)
    if len(resp) < 9 or resp[0] != 0xff or resp[1] != 0x86:
        raise ValueError(f"bad response: {resp.hex()}")
    return (resp[2] << 8) | resp[3]


def read_dht():
    temp, humidity = grovepi.dht(DHT_PORT, 1)  # 1 = DHT22
    return round(temp, 2), round(humidity, 2)


def main():
    write_header = not LOG_FILE.exists()

    print(f"Logging to {LOG_FILE} every {INTERVAL_S}s -- Ctrl+C to stop\n")

    with open(LOG_FILE, "a", newline="") as f, \
         serial.Serial(CO2_SERIAL, CO2_BAUD, timeout=2) as ser:

        writer = csv.DictWriter(f, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()

        while True:
            ts = datetime.now().isoformat(timespec="seconds")
            row = {"timestamp": ts, "condition": CONDITION, "co2_ppm": None, "temp_c": None, "humidity_pct": None}
            errors = []

            try:
                row["co2_ppm"] = read_co2(ser)
            except Exception as e:
                errors.append(f"CO2: {e}")

            try:
                row["temp_c"], row["humidity_pct"] = read_dht()
            except Exception as e:
                errors.append(f"T/RH: {e}")

            writer.writerow(row)
            f.flush()

            status = (f"{ts}  CO2={row['co2_ppm']} ppm  "
                      f"Temp={row['temp_c']} C  RH={row['humidity_pct']} %")
            if errors:
                status += f"  WARN: {'; '.join(errors)}"
            print(status)

            time.sleep(INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nLogger stopped.")
