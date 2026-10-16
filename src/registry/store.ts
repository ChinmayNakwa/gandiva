import { z } from "zod";
import { db } from "../db.js";
import { MAX_PRICE_UNITS, NETWORK, USDC_ADDRESS } from "../config.js";

export const CATEGORIES = ["data", "inference", "scraping"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LEDGER_STATUSES = ["paid", "paid_output_rejected", "refused", "failed_not_charged"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x EVM address");

export const serviceInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,64}$/).optional(),
  name: z.string().min(1).max(80),
  category: z.enum(CATEGORIES),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  price: z
    .string()
    .regex(/^\d+$/, "price is in USDC smallest units (6 decimals), e.g. 1000 = 0.001 USDC")
    .refine((p) => BigInt(p) > 0n && BigInt(p) <= MAX_PRICE_UNITS, "price must be > 0 and <= 100000 (0.10 USDC)"),
  network: z.string().default(NETWORK),
  asset: address.default(USDC_ADDRESS),
  payTo: address,
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  description: z.string().max(500).default(""),
  owner: z.string().max(80).default("external"),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export interface Service {
  id: string;
  name: string;
  category: Category;
  endpoint: string;
  method: "GET" | "POST";
  price: string;
  network: string;
  asset: string;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  description: string;
  owner: string;
}

export interface Reputation {
  attempts: number;
  successes: number;
  successRate: number;
  medianLatencyMs: number | null;
  score: number;
}

export type ServiceWithReputation = Service & { reputation: Reputation };

const rowToService = (r: any): Service => ({
  id: r.id,
  name: r.name,
  category: r.category,
  endpoint: r.endpoint,
  method: r.method,
  price: r.price,
  network: r.network,
  asset: r.asset,
  payTo: r.pay_to,
  inputSchema: JSON.parse(r.input_schema),
  outputSchema: JSON.parse(r.output_schema),
  description: r.description,
  owner: r.owner,
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);

export function upsertService(input: ServiceInput): Service {
  const s = serviceInput.parse(input);
  const id = s.id ?? slug(s.name);
  db.prepare(
    `INSERT INTO services (id,name,category,endpoint,method,price,network,asset,pay_to,input_schema,output_schema,description,owner)
     VALUES (@id,@name,@category,@endpoint,@method,@price,@network,@asset,@payTo,@inputSchema,@outputSchema,@description,@owner)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category, endpoint=excluded.endpoint,
       method=excluded.method, price=excluded.price, network=excluded.network, asset=excluded.asset, pay_to=excluded.pay_to,
       input_schema=excluded.input_schema, output_schema=excluded.output_schema, description=excluded.description, owner=excluded.owner`,
  ).run({ ...s, id, inputSchema: JSON.stringify(s.inputSchema), outputSchema: JSON.stringify(s.outputSchema) });
  return getService(id)!;
}

export function deleteService(id: string) {
  return db.prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
}

export function getService(id: string): Service | undefined {
  const r = db.prepare("SELECT * FROM services WHERE id = ?").get(id);
  return r ? rowToService(r) : undefined;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Reputation comes from the buyer-side ledger: every attempted call counts, only clean "paid" counts as success. */
export function reputationFor(serviceId: string): Reputation {
  const rows = db
    .prepare("SELECT status, latency_ms FROM ledger WHERE service_id = ? AND (reason IS NULL OR (reason NOT LIKE 'budget:%' AND reason NOT LIKE 'payment rejected:%'))")
    .all(serviceId) as { status: LedgerStatus; latency_ms: number }[];
  const successes = rows.filter((r) => r.status === "paid");
  const attempts = rows.length;
  return {
    attempts,
    successes: successes.length,
    successRate: attempts ? successes.length / attempts : 0,
    medianLatencyMs: median(successes.map((r) => r.latency_ms)),
    // Optimistic prior: an untried seller scores 1.0 so it gets explored; one bad call halves it
    score: (successes.length + 1) / (attempts + 1),
  };
}

export function searchServices(q: { category?: string; maxPrice?: string; sort?: string } = {}): ServiceWithReputation[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.category) {
    where.push("category = ?");
    params.push(q.category);
  }
  const rows = db.prepare(`SELECT * FROM services ${where.length ? "WHERE " + where.join(" AND ") : ""}`).all(...params);
  let list = rows.map(rowToService).map((s) => ({ ...s, reputation: reputationFor(s.id) }));
  if (q.maxPrice) {
    const max = BigInt(q.maxPrice);
    list = list.filter((s) => BigInt(s.price) <= max);
  }
  const sort = q.sort ?? "rank";
  list.sort((a, b) => {
    if (sort === "price") return Number(BigInt(a.price) - BigInt(b.price));
    if (sort === "latency") return (a.reputation.medianLatencyMs ?? 1e9) - (b.reputation.medianLatencyMs ?? 1e9);
    return rankCompare(a, b);
  });
  return list;
}

/** Buyer's choice order: reputation score first, then price, then latency. */
export function rankCompare(a: ServiceWithReputation, b: ServiceWithReputation) {
  const ds = b.reputation.score - a.reputation.score;
  if (Math.abs(ds) > 0.05) return ds;
  const dp = BigInt(a.price) - BigInt(b.price);
  if (dp !== 0n) return dp < 0n ? -1 : 1;
  return (a.reputation.medianLatencyMs ?? 1e9) - (b.reputation.medianLatencyMs ?? 1e9);
}

export interface LedgerEntry {
  runId?: string | null;
  buyer: string;
  seller: string;
  serviceId?: string | null;
  serviceName: string;
  endpoint: string;
  listed: string;
  asked?: string | null;
  paid: string;
  txHash?: string | null;
  status: LedgerStatus;
  reason?: string | null;
  latencyMs: number;
}

export function addLedger(e: LedgerEntry) {
  const ts = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO ledger (ts,run_id,buyer,seller,service_id,service_name,endpoint,listed,asked,paid,tx_hash,status,reason,latency_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(ts, e.runId ?? null, e.buyer, e.seller, e.serviceId ?? null, e.serviceName, e.endpoint, e.listed, e.asked ?? null, e.paid, e.txHash ?? null, e.status, e.reason ?? null, Math.round(e.latencyMs));
  return { id: Number(info.lastInsertRowid), ts, ...e };
}

export function listLedger(q: { runId?: string; limit?: number } = {}) {
  const rows = q.runId
    ? db.prepare("SELECT * FROM ledger WHERE run_id = ? ORDER BY id DESC").all(q.runId)
    : db.prepare("SELECT * FROM ledger ORDER BY id DESC LIMIT ?").all(q.limit ?? 500);
  return rows as any[];
}

export function addSale(s: { seller: string; payer?: string; amount: string; txHash?: string; status: string; reason?: string; latencyMs: number }) {
  db.prepare("INSERT INTO sales (ts,seller,payer,amount,tx_hash,status,reason,latency_ms) VALUES (?,?,?,?,?,?,?,?)").run(
    new Date().toISOString(),
    s.seller,
    s.payer ?? null,
    s.amount,
    s.txHash ?? null,
    s.status,
    s.reason ?? null,
    Math.round(s.latencyMs),
  );
}

export function listSales(limit = 500) {
  return db.prepare("SELECT * FROM sales ORDER BY id DESC LIMIT ?").all(limit) as any[];
}
