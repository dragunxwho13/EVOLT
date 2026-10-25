import { z } from "zod";
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  CONNECTOR_TYPES,
  DATASET_KINDS,
  HEALTH_STATUSES,
  KNOWN_CONNECTOR_TYPES,
  OPERATIONAL_STATUSES,
  PROVENANCES,
} from "@/config/domain";

/** Treat empty query-string values as absent. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const uuidSchema = z.uuid({ message: "Must be a valid identifier." });

export const latSchema = z.coerce.number().min(-90).max(90);
export const lngSchema = z.coerce.number().min(-180).max(180);

export const stationQuerySchema = z
  .object({
    q: opt(z.string().trim().max(100)),
    connector: opt(z.enum(CONNECTOR_TYPES)),
    minPowerKw: opt(z.coerce.number().min(0).max(1500)),
    availability: opt(z.enum(OPERATIONAL_STATUSES)),
    health: opt(z.enum(HEALTH_STATUSES)),
    lat: opt(latSchema),
    lng: opt(lngSchema),
    limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(500).default(100)),
    offset: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).default(0)),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: "Provide both lat and lng, or neither.",
    path: ["lat"],
  });
export type StationQuery = z.infer<typeof stationQuerySchema>;

export const chargerQuerySchema = z.object({
  q: opt(z.string().trim().max(100)),
  connector: opt(z.enum(CONNECTOR_TYPES)),
  health: opt(z.enum(HEALTH_STATUSES)),
  availability: opt(z.enum(OPERATIONAL_STATUSES)),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(5).max(100).default(25)),
});
export type ChargerQuery = z.infer<typeof chargerQuerySchema>;

export const alertQuerySchema = z.object({
  status: opt(z.enum([...ALERT_STATUSES, "active", "all"] as const)),
  severity: opt(z.enum(ALERT_SEVERITIES)),
  chargerId: opt(uuidSchema),
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
  pageSize: z.preprocess(blankToUndefined, z.coerce.number().int().min(5).max(100).default(25)),
});
export type AlertQuery = z.infer<typeof alertQuerySchema>;

export const alertStatusUpdateSchema = z.object({
  status: z.enum(ALERT_STATUSES),
  note: z.string().trim().max(500).optional().nullable(),
});

export const observationQuerySchema = z.object({
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(1000).default(200)),
});

export const recommendationQuerySchema = z
  .object({
    fromCharger: opt(uuidSchema),
    lat: opt(latSchema),
    lng: opt(lngSchema),
    connector: opt(z.enum(KNOWN_CONNECTOR_TYPES)),
    vehicle: opt(z.string().trim().max(64)),
    minPowerKw: opt(z.coerce.number().min(0).max(1500)),
    radiusKm: z.preprocess(blankToUndefined, z.coerce.number().min(1).max(500).default(25)),
    includeInspection: z.preprocess(blankToUndefined, z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),
    limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(50).default(10)),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: "Provide both lat and lng, or neither.",
    path: ["lat"],
  })
  .refine((v) => v.fromCharger !== undefined || v.lat !== undefined, {
    message: "Choose a reference charger or provide a location.",
    path: ["fromCharger"],
  });
export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;

/** "UTC", "none", or a fixed offset such as "+05:30" / "-04:00". */
const timezoneSchema = z
  .string()
  .trim()
  .regex(/^(UTC|none|[+-](0\d|1[0-4]):[0-5]\d)$/, "Choose a timezone such as UTC or +05:30.")
  .default("UTC")
  .transform((tz): number | null => {
    if (tz === "none") return null;
    if (tz === "UTC") return 0;
    const sign = tz.startsWith("-") ? -1 : 1;
    const [h, m] = tz.slice(1).split(":").map(Number);
    return sign * (h! * 60 + m!);
  });

export const importOptionsSchema = z.object({
  kind: z.enum([...DATASET_KINDS, "auto"] as const).default("auto"),
  mapping: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s) return undefined;
      try {
        const parsed = JSON.parse(s) as unknown;
        const result = z.record(z.string(), z.string().max(200).nullable()).safeParse(parsed);
        if (!result.success) throw new Error();
        return result.data;
      } catch {
        ctx.addIssue({ code: "custom", message: "Column mapping must be a JSON object of field → column name." });
        return z.NEVER;
      }
    }),
  defaultProvenance: z.enum(PROVENANCES).default("observed"),
  timezone: timezoneSchema,
});

export const sessionLoginSchema = z.object({ token: z.string().min(1).max(500) });

export const sensorIngestSchema = z.object({
  deviceId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  chargerCode: z.string().trim().max(64).optional(),
  readings: z
    .array(
      z.object({
        sensor: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/),
        value: z.number().finite(),
        unit: z.string().trim().min(1).max(16),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(500),
});

/** Converts URLSearchParams into a plain object for schema parsing. */
export function searchParamsToObject(params: URLSearchParams | Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  if (params instanceof URLSearchParams) {
    params.forEach((v, k) => {
      out[k] = v;
    });
  } else {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string") out[k] = v;
      else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
    }
  }
  return out;
}
