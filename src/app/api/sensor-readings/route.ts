import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { chargers, sensorReadings } from "@/lib/db/schema";
import { validationError, withErrorHandling } from "@/lib/errors";
import { dynamicGet, json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";
import { sensorIngestSchema, uuidSchema } from "@/lib/validation/schemas";

/**
 * Optional bench-sensor ingestion (e.g. the Arduino serial collector).
 * These readings are supporting context only and never change health status.
 */
export const POST = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const input = sensorIngestSchema.parse(body);
  const db = getDb();
  let chargerId: string | null = null;
  if (input.chargerCode) {
    const [c] = await db.select({ id: chargers.id }).from(chargers).where(eq(chargers.code, input.chargerCode));
    if (!c) throw validationError(`Unknown charger code "${input.chargerCode}".`);
    chargerId = c.id;
  }
  const now = Date.now();
  for (const r of input.readings) {
    if (new Date(r.recordedAt).getTime() > now + 10 * 60_000) throw validationError("Readings cannot be timestamped in the future.");
  }
  const inserted = await db
    .insert(sensorReadings)
    .values(
      input.readings.map((r) => ({
        deviceId: input.deviceId,
        chargerId,
        sensor: r.sensor,
        value: r.value,
        unit: r.unit,
        recordedAt: new Date(r.recordedAt),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: sensorReadings.id });
  return json({ received: input.readings.length, stored: inserted.length, duplicates: input.readings.length - inserted.length }, { status: 201 });
});

export const GET = dynamicGet(async (request: NextRequest) => {
  requireAdmin(request);
  const chargerParam = request.nextUrl.searchParams.get("chargerId");
  const db = getDb();
  const rows = await db
    .select()
    .from(sensorReadings)
    .where(chargerParam ? eq(sensorReadings.chargerId, uuidSchema.parse(chargerParam)) : undefined)
    .orderBy(desc(sensorReadings.recordedAt))
    .limit(200);
  return json(rows);
});
