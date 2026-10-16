import { ServiceError } from "../x402/paidRoute.js";

const cache = new Map<string, { at: number; rate: number; date: string }>();

/** ECB reference rates via Frankfurter, with open.er-api.com as a fallback source. */
export async function getRate(from: string, to: string): Promise<{ rate: number; date: string; source: string }> {
  from = from.toUpperCase();
  to = to.toUpperCase();
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10), source: "identity" };
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { rate: hit.rate, date: hit.date, source: "cache" };

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (res.ok) {
      const j: any = await res.json();
      const rate = j?.rates?.[to];
      if (typeof rate === "number") {
        cache.set(key, { at: Date.now(), rate, date: j.date });
        return { rate, date: j.date, source: "frankfurter (ECB)" };
      }
    }
  } catch {}

  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`).catch(() => null);
  const j: any = res && res.ok ? await res.json() : null;
  const rate = j?.rates?.[to];
  if (typeof rate !== "number") throw new ServiceError(`no rate available for ${from}->${to}`, 422);
  const date = (j.time_last_update_utc ? new Date(j.time_last_update_utc) : new Date()).toISOString().slice(0, 10);
  cache.set(key, { at: Date.now(), rate, date });
  return { rate, date, source: "open.er-api.com" };
}
