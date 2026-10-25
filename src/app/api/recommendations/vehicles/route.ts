import { listVehicleProfiles } from "@/features/recommendations/service";
import { dynamicGet, json } from "@/lib/http/route";

export const GET = dynamicGet(async () => json(await listVehicleProfiles()));
