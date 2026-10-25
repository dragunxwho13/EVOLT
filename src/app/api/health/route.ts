import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ANALYSIS_VERSION } from "@/config/analysis";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { pgErrorCode } from "@/lib/errors";
import { dynamicGet } from "@/lib/http/route";
import { editMode, writesEnabled } from "@/lib/security/admin";

type DbState = "ok" | "not_configured" | "unreachable" | "not_migrated";

/** Liveness and configuration check. Never exposes connection details. */
export const GET = dynamicGet(async () => {
  let database: DbState = "not_configured";
  if (isDatabaseConfigured()) {
    try {
      const result = await getDb().execute(sql`select to_regclass('public.chargers') is not null as migrated`);
      database = (result.rows[0] as { migrated?: boolean } | undefined)?.migrated ? "ok" : "not_migrated";
    } catch (err) {
      database = pgErrorCode(err) === "42P01" ? "not_migrated" : "unreachable";
    }
  }
  const healthy = database === "ok";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      writesEnabled: writesEnabled(),
      editMode: editMode(),
      analysisVersion: ANALYSIS_VERSION,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
});
