/*
 * EVOLT bench sensor sketch (optional, supplementary)
 * ---------------------------------------------------
 * Board:  Arduino Uno or compatible.
 * Output: Serial Monitor at 9600 baud (the LCD1602 is not used).
 *
 * Prints one line per reading in the form:
 *   EVOLT,<sensor>,<value>,<unit>
 * e.g.
 *   EVOLT,temp_c,27.41,°C
 *   EVOLT,a0_mv,1372.0,mV
 *
 * The collector in tools/serial-collector adds timestamps (the Uno has no clock)
 * and can forward readings to EVOLT's /api/sensor-readings endpoint.
 *
 * SAFETY AND SCOPE
 *  - This is a low-voltage bench demonstration only. NEVER connect the board or any
 *    sensor to a live EV charger, vehicle inlet or any high-voltage / high-current
 *    conductor.
 *  - These readings do NOT measure connector contact resistance and do not reproduce
 *    high-current charging conditions. EVOLT stores them as supporting context and
 *    never uses them to set a charger's health status.
 *
 * WIRING (adapt to the sensors in your kit)
 *  - LM35-style analogue temperature sensor: Vout -> A0, Vs -> 5V, GND -> GND.
 *    10 mV per °C. If your kit has a different sensor (thermistor module, DHT11),
 *    replace readTemperatureC() accordingly or set HAS_LM35 to 0 and use the raw
 *    A0 millivolt reading only.
 */

#define HAS_LM35 1
const uint8_t SENSOR_PIN = A0;
const unsigned long INTERVAL_MS = 5000;
const uint8_t SAMPLES = 16;  // average to reduce ADC noise

float readMillivolts() {
  unsigned long total = 0;
  for (uint8_t i = 0; i < SAMPLES; i++) {
    total += analogRead(SENSOR_PIN);
    delay(5);
  }
  float counts = total / (float)SAMPLES;
  return counts * (5000.0 / 1023.0);  // assumes the default 5 V reference
}

float readTemperatureC(float millivolts) {
  return millivolts / 10.0;  // LM35: 10 mV per °C
}

void setup() {
  Serial.begin(9600);
  while (!Serial) { ; }
  Serial.println("# EVOLT bench sketch ready. Bench demonstration only - never connect to live charging equipment.");
}

void loop() {
  float mv = readMillivolts();
  Serial.print("EVOLT,a0_mv,");
  Serial.print(mv, 1);
  Serial.println(",mV");
#if HAS_LM35
  Serial.print("EVOLT,temp_c,");
  Serial.print(readTemperatureC(mv), 2);
  Serial.println(",°C");
#endif
  delay(INTERVAL_MS);
}
