import { fleetRepairs } from "@/features/connector-health/maintenance";
import { dynamicGet, json } from "@/lib/http/route";

/** Every recorded maintenance event with its verified outcome, and success rates by kind of work. */
export const GET = dynamicGet(async () => json(await fleetRepairs()));
