/**
 * Temperature correction for resistance-like connector metrics.
 *
 * Metal resistance rises with temperature (about 0.39 % per °C for copper), so a contact
 * measured at 45 °C in May reads roughly 10 % higher than the same contact at 20 °C in
 * January. Comparing them unadjusted turns the season into a fake "trend". Each reading is
 * restated at the reference temperature:
 *
 *     R_ref = R_measured / (1 + α · (T − T_ref))
 *
 * Correction is all-or-nothing per metric: mixing corrected and uncorrected readings would
 * itself create jumps, so if any reading lacks a usable temperature, every reading is used as
 * measured and the reason is reported.
 */
import { ANALYSIS_PARAMS, type AnalysisParams } from "@/config/analysis";
import { METRICS, type MetricKey } from "@/config/domain";
import type { ObservationInput, TemperatureCorrection } from "@/types/analysis";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export function correctToReference(value: number, temperatureC: number, params: Pick<AnalysisParams, "temperatureReferenceC" | "temperatureCoefficientPerC"> = ANALYSIS_PARAMS): number {
  return value / (1 + params.temperatureCoefficientPerC * (temperatureC - params.temperatureReferenceC));
}

function usableTemperature(t: number | null | undefined, params: AnalysisParams): t is number {
  if (t === null || t === undefined || !Number.isFinite(t)) return false;
  const [lo, hi] = params.temperaturePlausibleC;
  return t >= lo && t <= hi;
}

export interface CorrectionResult {
  observations: ObservationInput[];
  info: TemperatureCorrection | null;
}

/**
 * Returns the observations to analyse (corrected when possible) and a description of what was
 * done. Metrics that are not temperature-dependent are returned unchanged with `info = null`.
 */
export function applyTemperatureCorrection(
  metric: MetricKey,
  observations: readonly ObservationInput[],
  params: AnalysisParams = ANALYSIS_PARAMS,
): CorrectionResult {
  if (!METRICS[metric].temperatureCorrected) return { observations: [...observations], info: null };
  const valid = observations.filter((o) => Number.isFinite(o.value));
  const withTemp = valid.filter((o) => usableTemperature(o.temperatureC, params));
  const base = {
    referenceC: params.temperatureReferenceC,
    coefficientPerC: params.temperatureCoefficientPerC,
    readings: valid.length,
    withTemperature: withTemp.length,
  };
  const temps = withTemp.map((o) => o.temperatureC as number);
  const minTempC = temps.length ? Math.min(...temps) : null;
  const maxTempC = temps.length ? Math.max(...temps) : null;

  if (valid.length === 0 || withTemp.length === 0) {
    return {
      observations: [...observations],
      info: {
        ...base,
        applied: false,
        minTempC,
        maxTempC,
        maxAdjustment: null,
        explanation:
          "No contact temperature was recorded with these readings, so they are used as measured. " +
          "Recording the temperature at each measurement lets EVOLT remove seasonal swings.",
      },
    };
  }
  if (withTemp.length < valid.length) {
    return {
      observations: [...observations],
      info: {
        ...base,
        applied: false,
        minTempC,
        maxTempC,
        maxAdjustment: null,
        explanation:
          `Only ${withTemp.length} of ${valid.length} readings record a usable contact temperature. ` +
          "Correcting some readings but not others would create artificial jumps, so all are used as measured.",
      },
    };
  }

  let maxAdjustment = 0;
  const corrected = observations.map((o) => {
    if (!usableTemperature(o.temperatureC, params) || !Number.isFinite(o.value)) return { ...o };
    const v = correctToReference(o.value, o.temperatureC, params);
    if (o.value !== 0) maxAdjustment = Math.max(maxAdjustment, Math.abs(v - o.value) / Math.abs(o.value));
    return { ...o, value: v };
  });
  return {
    observations: corrected,
    info: {
      ...base,
      applied: true,
      minTempC,
      maxTempC,
      maxAdjustment,
      explanation:
        `All ${valid.length} readings were restated at ${params.temperatureReferenceC} °C ` +
        `(recorded ${formatNumber(minTempC!, 1)}–${formatNumber(maxTempC!, 1)} °C, coefficient ${formatPercent(params.temperatureCoefficientPerC, 2)} per °C). ` +
        `The largest adjustment to one reading was ${formatPercent(maxAdjustment, 1)}. Baselines, alerts and forecasts use the restated values.`,
    },
  };
}

/** The value as analysed, for charts and tables that show stored (raw) readings. */
export function analysedValue(
  metric: MetricKey,
  value: number,
  temperatureC: number | null | undefined,
  applied: boolean,
  params: AnalysisParams = ANALYSIS_PARAMS,
): number {
  if (!applied || !METRICS[metric].temperatureCorrected || !usableTemperature(temperatureC, params)) return value;
  return correctToReference(value, temperatureC, params);
}
