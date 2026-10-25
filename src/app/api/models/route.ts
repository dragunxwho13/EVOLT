import { latestReports, sessionStats } from "@/features/learning/service";
import { dynamicGet, json } from "@/lib/http/route";

/** Latest cross-validated model report for each labelled target. */
export const GET = dynamicGet(async () => json({ stats: await sessionStats(), reports: await latestReports() }));
