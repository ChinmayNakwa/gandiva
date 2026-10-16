import "dotenv/config";

export const BASE = process.env.GANDIVA_URL || `http://localhost:${process.env.PORT || "4021"}`;

const headers = () => ({ "Content-Type": "application/json", ...(process.env.BUYER_TOKEN ? { "x-buyer-token": process.env.BUYER_TOKEN } : {}) });

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, body === undefined ? {} : { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(j)}`);
  return j as T;
}

/** Best-effort cleanup of a test listing. Deleting needs ADMIN_TOKEN on the server; without it the listing just stays (re-registering with the same payTo still works). */
export async function removeListing(id: string) {
  if (!process.env.ADMIN_TOKEN) return;
  await fetch(`${BASE}/registry/services/${id}`, { method: "DELETE", headers: { "x-admin-token": process.env.ADMIN_TOKEN } }).catch(() => {});
}

export async function runTask(task: string, budget: string, maxConcurrency: number, quiet = false, extra: { dryRun?: boolean; mode?: string } = {}) {
  const { runId } = await api("/buyer/run", { task, budget, maxConcurrency, ...extra });
  let seen = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const run = await api(`/buyer/runs/${runId}`);
    if (!quiet) for (const line of run.log.slice(seen)) console.log("  " + line);
    seen = run.log.length;
    if (run.state !== "running") return run;
  }
}

export const units = (u: string | bigint) => (Number(u) / 1e6).toFixed(6);
