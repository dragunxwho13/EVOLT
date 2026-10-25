export const ADMIN = { authorization: "Bearer integration-test-admin-token-000" };

export function uploadRequest(
  url: string,
  file: { name: string; content: string; type?: string },
  fields: Record<string, string>,
  headers: Record<string, string> = ADMIN,
): Request {
  const form = new FormData();
  form.set("file", new File([file.content], file.name, { type: file.type ?? "text/csv" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request(`http://localhost${url}`, { method: "POST", body: form, headers });
}

export async function body<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Weekly contact-resistance readings: stable for 14 weeks then rising — should trigger alerts. */
export function degradingObservationsCsv(code: string, start = Date.UTC(2026, 0, 5, 9)): string {
  const lines = ["charger_code,observed_at,metric,value,unit,provenance"];
  for (let i = 0; i < 24; i++) {
    const t = new Date(start + i * 7 * 86_400_000).toISOString();
    const wobble = [0, 1, -1, 0.5, -0.5][i % 5]! * 0.003;
    const v = 0.3 + wobble + (i >= 14 ? 0.3 * 0.06 * (i - 13) : 0);
    lines.push(`${code},${t},contact_resistance,${v.toFixed(4)},mΩ,simulated`);
  }
  return lines.join("\n");
}
