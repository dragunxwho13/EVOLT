#!/usr/bin/env python3
"""
EVOLT serial collector (optional, runs on your own computer — not on Vercel).

Reads lines of the form ``EVOLT,<sensor>,<value>,<unit>`` from an Arduino over USB
serial, timestamps them, appends them to a local CSV file and, if configured, sends
them in batches to EVOLT's ``POST /api/sensor-readings`` endpoint.

    pip install pyserial
    export EVOLT_URL=http://localhost:3000          # or your Vercel URL
    export EVOLT_ADMIN_TOKEN=...                     # same value as the server
    python collect.py --port /dev/ttyUSB0 --device bench-uno-1 --charger-code SYN-01-C1

Readings are supporting context only. They never change a charger's health status,
and the bench rig must never be connected to live charging equipment.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

try:
    import serial  # type: ignore
except ImportError:  # pragma: no cover - guidance for first-time users
    sys.exit("pyserial is required: pip install pyserial")

SENSOR_OK = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


def parse_line(line: str):
    parts = line.strip().split(",")
    if len(parts) != 4 or parts[0] != "EVOLT":
        return None
    _, sensor, value, unit = parts
    if not sensor or not set(sensor) <= SENSOR_OK:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return {"sensor": sensor, "value": number, "unit": unit[:16]}


def send(url: str, token: str, device: str, charger: str | None, readings: list[dict]) -> None:
    payload = {"deviceId": device, "readings": readings}
    if charger:
        payload["chargerCode"] = charger
    req = urllib.request.Request(
        url.rstrip("/") + "/api/sensor-readings",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 - user-supplied EVOLT URL
        body = json.loads(res.read().decode())
        print(f"sent {len(readings)} reading(s): {body.get('data')}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", required=True, help="Serial port, e.g. /dev/ttyUSB0 or COM3")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--device", default="bench-uno-1", help="Device identifier stored with each reading")
    ap.add_argument("--charger-code", default=None, help="Optional EVOLT charger code to link readings to")
    ap.add_argument("--csv", default="readings.csv", help="Local CSV log file")
    ap.add_argument("--batch", type=int, default=12, help="Readings per upload")
    args = ap.parse_args()

    url = os.environ.get("EVOLT_URL")
    token = os.environ.get("EVOLT_ADMIN_TOKEN")
    if bool(url) != bool(token):
        sys.exit("Set both EVOLT_URL and EVOLT_ADMIN_TOKEN to upload, or neither to log locally only.")

    pending: list[dict] = []
    with serial.Serial(args.port, args.baud, timeout=2) as port, open(args.csv, "a", newline="") as fh:
        writer = csv.writer(fh)
        if fh.tell() == 0:
            writer.writerow(["recorded_at", "device_id", "sensor", "value", "unit"])
        print(f"Listening on {args.port}. Press Ctrl+C to stop.")
        try:
            while True:
                raw = port.readline().decode(errors="replace")
                reading = parse_line(raw)
                if not reading:
                    continue
                reading["recordedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                writer.writerow([reading["recordedAt"], args.device, reading["sensor"], reading["value"], reading["unit"]])
                fh.flush()
                pending.append(reading)
                if url and len(pending) >= args.batch:
                    try:
                        send(url, token, args.device, args.charger_code, pending)
                        pending.clear()
                    except (urllib.error.URLError, TimeoutError) as err:
                        print(f"upload failed, will retry with the next batch: {err}", file=sys.stderr)
                        pending = pending[-500:]
                time.sleep(0.01)
        except KeyboardInterrupt:
            if url and pending:
                send(url, token, args.device, args.charger_code, pending)
            print("Stopped.")


if __name__ == "__main__":
    main()
