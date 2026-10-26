import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DatasetKind, Provenance } from "@/config/domain";
import { recomputeHealth, type RecomputeResult } from "@/features/connector-health/service";
import { trainModels, type TrainingSummary } from "@/features/learning/service";
import { getDb } from "@/lib/db/client";
import { chargers, chargingSessions, datasetImports, healthObservations, stations } from "@/lib/db/schema";
import { conflict, pgErrorCode, validationError } from "@/lib/errors";
import type { ImportRowIssue } from "@/types/analysis";
import { DATASET_FIELDS, detectKind, missingRequiredFields, suggestMapping, type ColumnMapping, type KindDetection } from "./fields";
import { assertSupportedFile, maxUploadBytes, parseDatasetText, type RawRow } from "./parse";
import {
  observationKey,
  planObservations,
  planRegistry,
  planSessions,
  sessionKey,
  type DataQualityFinding,
  type ImportCounts,
  type ObservationPlan,
  type RegistryPlan,
  type SessionPlan,
} from "./plan";

export interface ImportInput {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  /** "auto" lets EVOLT detect the file type from its columns. */
  kind: DatasetKind | "auto";
  mapping?: ColumnMapping;
  defaultProvenance: Provenance;
  /** Timezone for timestamps written without one, as minutes east of UTC (null = reject them). */
  assumeOffsetMinutes: number | null;
}

export interface SessionSummary {
  stations: number;
  chargers: number;
  sessions: number;
  numericColumns: string[];
  labelColumns: { field: string; column: string; classes: string[] }[];
  timeRange: { from: string; to: string } | null;
}

export interface PreviewResult {
  kind: DatasetKind;
  detected: KindDetection;
  fileName: string;
  fileHash: string;
  format: "csv" | "json";
  headers: string[];
  /** First few raw values per column, to help people map columns. */
  columnSamples: Record<string, string[]>;
  mapping: ColumnMapping;
  missingRequired: string[];
  counts: ImportCounts | null;
  issues: ImportRowIssue[];
  issuesTruncated: boolean;
  sample: Record<string, string | number | null>[];
  findings: DataQualityFinding[];
  sessionSummary: SessionSummary | null;
  /** True when rows were rejected only because their timestamps have no timezone. */
  needsTimezone: boolean;
  alreadyImportedAt: string | null;
  canCommit: boolean;
}

const MAX_ISSUES_RETURNED = 200;
const MAX_ISSUES_STORED = 500;

type Prepared =
  | { kind: "observations"; plan: ObservationPlan }
  | { kind: "registry"; plan: RegistryPlan }
  | { kind: "sessions"; plan: SessionPlan };

function hashFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw validationError("The file is not valid UTF-8 text. Save it as “CSV UTF-8” and try again.");
  }
}

async function prepare(
  kind: DatasetKind,
  input: ImportInput,
  mapping: ColumnMapping,
  headers: string[],
  rows: RawRow[],
): Promise<Prepared> {
  const db = getDb();
  const now = new Date();
  if (kind === "observations") {
    const header = mapping.charger_code;
    const codes = [...new Set(rows.map((r) => (header ? (r[header] ?? "").trim() : "")).filter(Boolean))];
    const known = codes.length
      ? await db.select({ id: chargers.id, code: chargers.code }).from(chargers).where(inArray(chargers.code, codes))
      : [];
    const chargerIdByCode = new Map(known.map((c) => [c.code, c.id]));
    // First pass without DB duplicates to learn the time range, then look up existing keys once.
    const firstPass = planObservations(rows, mapping, chargerIdByCode, new Set(), now, input.defaultProvenance, input.assumeOffsetMinutes);
    const existingKeys = new Set<string>();
    if (firstPass.candidates.length) {
      const times = firstPass.candidates.map((c) => c.observedAt.getTime());
      const existing = await db
        .select({ chargerId: healthObservations.chargerId, metric: healthObservations.metric, observedAt: healthObservations.observedAt })
        .from(healthObservations)
        .where(
          and(
            inArray(healthObservations.chargerId, [...new Set(firstPass.candidates.map((c) => c.chargerId))]),
            gte(healthObservations.observedAt, new Date(Math.min(...times))),
            lte(healthObservations.observedAt, new Date(Math.max(...times))),
          ),
        );
      for (const e of existing) existingKeys.add(observationKey(e.chargerId, e.metric, e.observedAt));
    }
    const plan = existingKeys.size
      ? planObservations(rows, mapping, chargerIdByCode, existingKeys, now, input.defaultProvenance, input.assumeOffsetMinutes)
      : firstPass;
    return { kind: "observations", plan };
  }

  if (kind === "sessions") {
    const firstPass = planSessions(rows, headers, mapping, new Set(), now, input.assumeOffsetMinutes);
    const codes = firstPass.chargers.map((c) => c.code);
    const existingKeys = new Set<string>();
    if (codes.length) {
      const existing = await db
        .select({ code: chargers.code, startedAt: chargingSessions.startedAt })
        .from(chargingSessions)
        .innerJoin(chargers, eq(chargers.id, chargingSessions.chargerId))
        .where(inArray(chargers.code, codes));
      for (const e of existing) existingKeys.add(sessionKey(e.code, e.startedAt));
    }
    const plan = existingKeys.size ? planSessions(rows, headers, mapping, existingKeys, now, input.assumeOffsetMinutes) : firstPass;
    return { kind: "sessions", plan };
  }

  const header = mapping.charger_code;
  const codes = [...new Set(rows.map((r) => (header ? (r[header] ?? "").trim() : "")).filter(Boolean))];
  const existing = codes.length
    ? await db
        .select({ code: chargers.code, stationCode: stations.code })
        .from(chargers)
        .innerJoin(stations, eq(stations.id, chargers.stationId))
        .where(inArray(chargers.code, codes))
    : [];
  return { kind: "registry", plan: planRegistry(rows, mapping, new Map(existing.map((e) => [e.code, e.stationCode]))) };
}

function validateUpload(input: ImportInput): "csv" | "json" {
  const format = assertSupportedFile(input.fileName, input.mimeType);
  if (input.bytes.byteLength === 0) throw validationError("The file is empty.");
  if (input.bytes.byteLength > maxUploadBytes()) {
    throw validationError(`The file exceeds the ${Math.round(maxUploadBytes() / 1024)} KiB upload limit.`);
  }
  return format;
}

async function findCompletedImport(fileHash: string) {
  const [row] = await getDb()
    .select({ id: datasetImports.id, createdAt: datasetImports.createdAt })
    .from(datasetImports)
    .where(and(eq(datasetImports.fileHash, fileHash), eq(datasetImports.status, "completed")));
  return row ?? null;
}

function sampleOf(prepared: Prepared): Record<string, string | number | null>[] {
  if (prepared.kind === "observations") {
    return prepared.plan.candidates.slice(0, 15).map((c) => ({
      row: c.row,
      charger_code: c.chargerCode,
      observed_at: c.observedAt.toISOString(),
      metric: c.metric,
      value: c.value,
      unit: c.sourceUnit,
      provenance: c.provenance,
    }));
  }
  if (prepared.kind === "sessions") {
    const lossCol = Object.keys(prepared.plan.sessions[0]?.values ?? {}).find((k) => k === "power_loss");
    return prepared.plan.sessions.slice(0, 15).map((s) => ({
      row: s.row,
      station: s.stationCode,
      charger: s.chargerCode,
      time_utc: s.startedAt.toISOString().replace("T", " ").slice(0, 16),
      area: s.area,
      charging_type: s.chargingMode,
      ...(lossCol ? { power_loss_kW: s.values[lossCol] ?? null } : {}),
      ...Object.fromEntries(Object.entries(s.labels).map(([k, v]) => [k, v])),
    }));
  }
  const stationByCode = new Map(prepared.plan.stations.map((s) => [s.code, s]));
  return prepared.plan.chargers.slice(0, 15).map((c) => {
    const s = stationByCode.get(c.stationCode)!;
    return {
      row: c.row,
      station_code: c.stationCode,
      station_name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      charger_code: c.code,
      connector_type: c.connectorType,
      rated_power_kw: c.ratedPowerKw,
      operational_status: c.operationalStatus,
      action: c.isUpdate ? "update" : "insert",
    };
  });
}

function columnSamples(headers: string[], rows: RawRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const h of headers) {
    const vals: string[] = [];
    for (const r of rows) {
      const v = (r[h] ?? "").trim();
      if (v && !vals.includes(v)) vals.push(v.slice(0, 40));
      if (vals.length >= 3) break;
    }
    out[h] = vals;
  }
  return out;
}

function sessionSummaryOf(plan: SessionPlan): SessionSummary {
  const times = plan.file.times;
  let from = Infinity;
  let to = -Infinity;
  for (const t of times) {
    if (t < from) from = t;
    if (t > to) to = t;
  }
  return {
    stations: plan.file.stations,
    chargers: plan.file.chargers,
    sessions: plan.file.sessions,
    numericColumns: plan.numericColumns,
    labelColumns: plan.labelColumns,
    timeRange: times.length ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : null,
  };
}

function resolveKind(input: ImportInput, headers: string[]): { kind: DatasetKind; detected: KindDetection } {
  const detected = detectKind(headers);
  return { kind: input.kind === "auto" ? detected.kind : input.kind, detected };
}

export async function previewImport(input: ImportInput): Promise<PreviewResult> {
  const format = validateUpload(input);
  const parsed = parseDatasetText(decode(input.bytes), format);
  const { kind, detected } = resolveKind(input, parsed.headers);
  const fileHash = hashFile(input.bytes);
  const mapping = sanitizeMapping(kind, input.mapping ?? suggestMapping(kind, parsed.headers), parsed.headers);
  const missingRequired = missingRequiredFields(kind, mapping);
  const previous = await findCompletedImport(fileHash);

  const base = {
    kind,
    detected,
    fileName: input.fileName,
    fileHash,
    format,
    headers: parsed.headers,
    columnSamples: columnSamples(parsed.headers, parsed.rows),
    mapping,
    missingRequired,
    alreadyImportedAt: previous ? previous.createdAt.toISOString() : null,
  };
  if (missingRequired.length) {
    return {
      ...base,
      counts: null,
      issues: [],
      issuesTruncated: false,
      sample: [],
      findings: [],
      sessionSummary: null,
      needsTimezone: false,
      canCommit: false,
    };
  }
  const prepared = await prepare(kind, input, mapping, parsed.headers, parsed.rows);
  const { issues, counts } = prepared.plan;
  const tzRejects = issues.filter((i) => i.kind === "rejected" && /has no timezone/.test(i.message)).length;
  return {
    ...base,
    counts,
    issues: issues.slice(0, MAX_ISSUES_RETURNED),
    issuesTruncated: issues.length > MAX_ISSUES_RETURNED,
    sample: sampleOf(prepared),
    findings: prepared.kind === "sessions" ? prepared.plan.findings : [],
    sessionSummary: prepared.kind === "sessions" ? sessionSummaryOf(prepared.plan) : null,
    needsTimezone: tzRejects > 0,
    canCommit: !previous && counts.accepted > 0,
  };
}

/** Drops mapping entries that point at columns not present in the file. */
function sanitizeMapping(kind: DatasetKind, mapping: ColumnMapping, headers: string[]): ColumnMapping {
  const headerSet = new Set(headers);
  const out: ColumnMapping = {};
  for (const f of DATASET_FIELDS[kind]) {
    const m = mapping[f.key];
    out[f.key] = m && headerSet.has(m) ? m : null;
  }
  return out;
}

export interface CommitResult {
  importId: string;
  kind: DatasetKind;
  counts: ImportCounts;
  inserted: number;
  updated: number;
  stationsTouched: number;
  chargersTouched: number;
  observationsStored: number;
  issues: ImportRowIssue[];
  issuesTruncated: boolean;
  analysis: RecomputeResult;
  training: TrainingSummary | null;
}

export async function commitImport(input: ImportInput): Promise<CommitResult> {
  const format = validateUpload(input);
  const parsed = parseDatasetText(decode(input.bytes), format);
  const { kind } = resolveKind(input, parsed.headers);
  const fileHash = hashFile(input.bytes);
  const mapping = sanitizeMapping(kind, input.mapping ?? suggestMapping(kind, parsed.headers), parsed.headers);
  const missing = missingRequiredFields(kind, mapping);
  if (missing.length) throw validationError(`Map the required columns first: ${missing.join(", ")}.`);
  if (await findCompletedImport(fileHash)) throw conflict("This exact file has already been imported.");

  const prepared = await prepare(kind, input, mapping, parsed.headers, parsed.rows);
  const { counts, issues } = prepared.plan;
  if (counts.accepted === 0) throw validationError("No rows can be imported. Fix the reported problems and try again.");

  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let observationsStored = 0;
  let stationsTouched = 0;
  let affected: string[] = [];
  let importId: string;
  const source = `import:${input.fileName.slice(0, 100)}`;
  try {
    importId = await db.transaction(async (tx) => {
      const [record] = await tx
        .insert(datasetImports)
        .values({
          kind,
          fileName: input.fileName.slice(0, 200),
          fileHash,
          status: "completed",
          totalRows: counts.total,
          acceptedRows: counts.accepted,
          rejectedRows: counts.rejected,
          duplicateRows: counts.duplicate,
          skippedRows: counts.skipped,
          issues: issues.slice(0, MAX_ISSUES_STORED),
        })
        .returning({ id: datasetImports.id });
      const now = new Date();

      if (prepared.kind === "observations") {
        const rows = prepared.plan.candidates;
        for (let i = 0; i < rows.length; i += 1000) {
          const chunk = rows.slice(i, i + 1000);
          const res = await tx
            .insert(healthObservations)
            .values(
              chunk.map((c) => ({
                chargerId: c.chargerId,
                metric: c.metric,
                observedAt: c.observedAt,
                value: c.value,
                sourceUnit: c.sourceUnit,
                temperatureC: c.temperatureC,
                provenance: c.provenance,
                source: c.source,
                importId: record!.id,
              })),
            )
            .onConflictDoNothing()
            .returning({ id: healthObservations.id });
          inserted += res.length;
        }
        if (inserted !== rows.length) {
          // A concurrent writer stored some of these rows first; report honestly.
          throw conflict("Some observations were stored by another import while this one was running. Preview again.");
        }
        observationsStored = inserted;
        affected = [...new Set(rows.map((c) => c.chargerId))];
      } else if (prepared.kind === "sessions") {
        const plan = prepared.plan;
        const stationIds = new Map<string, string>();
        for (const s of plan.stations) {
          const [row] = await tx
            .insert(stations)
            .values({ code: s.code, name: s.name, isSynthetic: false, source })
            .onConflictDoUpdate({ target: stations.code, set: { updatedAt: now } })
            .returning({ id: stations.id });
          stationIds.set(s.code, row!.id);
        }
        stationsTouched = plan.stations.length;
        const chargerIds = new Map<string, string>();
        for (const c of plan.chargers) {
          const [row] = await tx
            .insert(chargers)
            .values({
              code: c.code,
              stationId: stationIds.get(c.stationCode)!,
              connectorType: c.connectorType,
              chargingMode: c.chargingMode,
              operationalStatus: "unknown",
            })
            .onConflictDoUpdate({ target: chargers.code, set: { chargingMode: c.chargingMode, updatedAt: now } })
            .returning({ id: chargers.id, stationId: chargers.stationId, inserted: sql<boolean>`(xmax = 0)` });
          if (row!.stationId !== stationIds.get(c.stationCode)) {
            throw validationError(`Charger "${c.code}" already exists at a different station; rename it in the file.`);
          }
          if (row!.inserted) inserted++;
          else updated++;
          chargerIds.set(c.code, row!.id);
        }
        const lossCol = mapping.power_loss;
        const vfCol = mapping.voltage_fluctuation;
        for (let i = 0; i < plan.sessions.length; i += 500) {
          const chunk = plan.sessions.slice(i, i + 500);
          await tx
            .insert(chargingSessions)
            .values(
              chunk.map((s) => ({
                chargerId: chargerIds.get(s.chargerCode)!,
                importId: record!.id,
                startedAt: s.startedAt,
                area: s.area,
                chargingMode: s.chargingMode,
                values: s.values,
                labels: s.labels,
                provenance: input.defaultProvenance,
              })),
            )
            .onConflictDoNothing();
          const obs = chunk.flatMap((s) => {
            const out: (typeof healthObservations.$inferInsert)[] = [];
            const chargerId = chargerIds.get(s.chargerCode)!;
            if (lossCol && s.values[lossCol] !== undefined) {
              out.push({ chargerId, metric: "power_loss", observedAt: s.startedAt, value: s.values[lossCol]!, sourceUnit: "kW (assumed)", provenance: input.defaultProvenance, source, importId: record!.id });
            }
            if (vfCol && s.values[vfCol] !== undefined) {
              out.push({ chargerId, metric: "voltage_fluctuation", observedAt: s.startedAt, value: s.values[vfCol]!, sourceUnit: "% (assumed)", provenance: input.defaultProvenance, source, importId: record!.id });
            }
            return out;
          });
          if (obs.length) {
            const res = await tx.insert(healthObservations).values(obs).onConflictDoNothing().returning({ id: healthObservations.id });
            observationsStored += res.length;
          }
        }
        affected = [...chargerIds.values()];
      } else {
        const stationIds = new Map<string, string>();
        for (const s of prepared.plan.stations) {
          const [row] = await tx
            .insert(stations)
            .values({ ...s, isSynthetic: false, source })
            .onConflictDoUpdate({
              target: stations.code,
              set: {
                name: s.name,
                address: s.address,
                city: s.city,
                region: s.region,
                country: s.country,
                latitude: s.latitude,
                longitude: s.longitude,
                operator: s.operator,
                updatedAt: now,
              },
            })
            .returning({ id: stations.id });
          stationIds.set(s.code, row!.id);
        }
        stationsTouched = prepared.plan.stations.length;
        for (const c of prepared.plan.chargers) {
          const [row] = await tx
            .insert(chargers)
            .values({
              code: c.code,
              stationId: stationIds.get(c.stationCode)!,
              connectorType: c.connectorType,
              ratedPowerKw: c.ratedPowerKw,
              operationalStatus: c.operationalStatus,
              operationalStatusAt: now,
            })
            .onConflictDoUpdate({
              target: chargers.code,
              set: {
                connectorType: c.connectorType,
                ratedPowerKw: c.ratedPowerKw,
                operationalStatus: c.operationalStatus,
                operationalStatusAt: now,
                updatedAt: now,
              },
            })
            .returning({ id: chargers.id, inserted: sql<boolean>`(xmax = 0)` });
          if (row!.inserted) inserted++;
          else updated++;
          affected.push(row!.id);
        }
      }
      await tx.update(datasetImports).set({ affectedChargers: affected.length }).where(eq(datasetImports.id, record!.id));
      return record!.id;
    });
  } catch (err) {
    if (pgErrorCode(err) === "23505") throw conflict("This exact file has already been imported.");
    await recordFailedImport(input, kind, fileHash, counts);
    throw err;
  }

  const analysis = await recomputeHealth(affected);
  const training = prepared.kind === "sessions" && prepared.plan.labelColumns.length ? await trainModels() : null;
  return {
    importId,
    kind,
    counts,
    inserted,
    updated,
    stationsTouched,
    chargersTouched: affected.length,
    observationsStored,
    issues: issues.slice(0, MAX_ISSUES_RETURNED),
    issuesTruncated: issues.length > MAX_ISSUES_RETURNED,
    analysis,
    training,
  };
}

async function recordFailedImport(input: ImportInput, kind: DatasetKind, fileHash: string, counts: ImportCounts) {
  try {
    await getDb()
      .insert(datasetImports)
      .values({
        kind,
        fileName: input.fileName.slice(0, 200),
        fileHash,
        status: "failed",
        totalRows: counts.total,
        acceptedRows: 0,
        rejectedRows: counts.rejected,
        duplicateRows: counts.duplicate,
        skippedRows: counts.skipped,
      });
  } catch {
    // Recording the failure is best-effort; the original error is what the caller sees.
  }
}

export async function listImports(limit = 20) {
  return getDb().select().from(datasetImports).orderBy(desc(datasetImports.createdAt)).limit(limit);
}

/** Removes every synthetic demonstration station (and, by cascade, its chargers, readings and alerts). */
export async function removeSyntheticData(): Promise<{ stations: number }> {
  const removed = await getDb().delete(stations).where(eq(stations.isSynthetic, true)).returning({ id: stations.id });
  return { stations: removed.length };
}

/** Counts of synthetic vs imported records, so the UI can offer the right actions. */
export async function dataInventory() {
  const db = getDb();
  const [row] = await db.execute<{ synthetic: number; imported: number; sessions: number }>(sql`
    select
      (select count(*)::int from stations where is_synthetic) as synthetic,
      (select count(*)::int from stations where not is_synthetic) as imported,
      (select count(*)::int from charging_sessions) as sessions
  `).then((r) => r.rows);
  return row ?? { synthetic: 0, imported: 0, sessions: 0 };
}
