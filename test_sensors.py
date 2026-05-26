"""
Quick sanity check -- run this first after wiring to confirm both sensors respond.
Usage: python3 test_sensors.py

Sensors:
  CO2  #778 (MH-Z16)                              -> GrovePi UART port -> /dev/serial0
  T/RH #656 (Seeed Temp & Humidity Pro v1.0, DHT22) -> GrovePi Digital D4
"""

import serial
import grovepi
import time

DHT_PORT   = 4        # Digital D4 -- change if wired to different port
CO2_SERIAL = "/dev/serial0"
CO2_BAUD   = 9600

CO2_CMD = b'\xff\x01\x86\x00\x00\x00\x00\x00\x79'


def read_co2(ser):
    ser.write(CO2_CMD)
    time.sleep(0.1)
    resp = ser.read(9)
    if len(resp) < 9 or resp[0] != 0xff or resp[1] != 0x86:
        return None
    return (resp[2] << 8) | resp[3]


def read_dht():
    return grovepi.dht(DHT_PORT, 1)  # 1 = DHT22; returns [temp_c, humidity_%]


print("=== Ventis Sensor Test ===\n")

# CO2
try:
    with serial.Serial(CO2_SERIAL, CO2_BAUD, timeout=2) as ser:
        ppm = read_co2(ser)
        if ppm is not None:
            print(f"CO2:  {ppm} ppm  OK")
        else:
            print("CO2:  bad response -- check UART wiring")
except Exception as e:
    print(f"CO2:  FAILED -- {e}")

# Temp + Humidity
try:
    temp, humidity = read_dht()
    print(f"Temp: {temp:.1f} C  OK")
    print(f"RH:   {humidity:.1f} %  OK")
except Exception as e:
    print(f"T/RH: FAILED -- {e}")
