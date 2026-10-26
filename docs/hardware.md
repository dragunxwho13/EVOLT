# Arduino bench (optional)

[← Back to README](../README.md)

A standalone, **low-voltage** demonstration that is not required to run EVOLT.

| Part | Role |
|---|---|
| `hardware/evolt_bench/evolt_bench.ino` | Arduino Uno sketch. Averages 16 readings from pin A0, converts them to millivolts (5 V reference), optionally converts to an LM35-style temperature, and prints `EVOLT,<sensor>,<value>,<unit>` at 9600 baud every 5 s |
| `tools/serial-collector/collect.py` | Python 3 + `pyserial`. Logs those lines with host timestamps and can optionally post them to `/api/sensor-readings` |

Wiring (optional LM35): `Vout → A0`, `Vs → 5V`, `GND → GND`.

```bash
python -m pip install pyserial
python tools/serial-collector/collect.py --port COM3 --device bench-uno-1
```

Bench readings are supporting context only. They never set a charger's health status or raise
an alert.

> **Safety:** never connect the bench circuit to a live charger, a vehicle inlet or any
> high-voltage or high-current conductor.

## The recorded run and its scaling

The three-connector run (`database/data/raw/degradation_data.xlsx`) is stored in the database
and analysed on the **Arduino bench** page, which scales it to representative chargers
parameter by parameter. Formulas, assumptions, references and calibration requirements:
[scaling.md](scaling.md).

## Engineering motivation (references)

1. Pieszka-Lyson et al. (2024), *Determination of Contact Resistance of Thermal Interface
   Materials Used in Thermal Monitoring Systems of EV Charging Inlets*, Materials 17(13) 3103,
   doi:10.3390/ma17133103.
2. NREL (2025), *Thermal Evaluation of CCS and NACS Reference Devices and Adapters*.
3. IEC 61851-1:2017, *Electric vehicle conductive charging system — General requirements*.

They motivate why contact resistance and voltage drop matter. They are not evidence that EVOLT
is validated or standards-compliant.
