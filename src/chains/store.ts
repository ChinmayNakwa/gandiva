import { db } from "../db.js";

/** Where one input field of a step comes from: the buyer's request, a fixed value, or an earlier step's output. */
export type Source = { from: "buyer"; field: string } | { from: "fixed"; value: unknown } | { from: "step"; step: number; field: string };

export interface ChainStep {
  serviceId: string;
  input: Record<string, Source>;
  /** canonical([category, inputSchema, outputSchema]) of the chosen seller when the chain was saved: any verified seller with the same key can stand in. */
  key: string;
}

export interface Chain {
  serviceId: string;
  /** Signed-in wallet that owns the listing (lower case); its agent wallet pays the steps and receives the earnings. */
  owner: string;
  steps: ChainStep[];
  /** Most this chain may spend on its steps for one request, in USDC units. */
  subBudget: bigint;
}

const rowToChain = (r: any): Chain => ({ serviceId: r.service_id, owner: r.owner, steps: JSON.parse(r.steps_json), subBudget: BigInt(r.sub_budget) });

export const getChain = (serviceId: string): Chain | undefined => {
  const r = db.prepare("SELECT * FROM chain_sellers WHERE service_id = ?").get(serviceId);
  return r ? rowToChain(r) : undefined;
};

/** Chains are never hired by other chains (or by travel-brief), so a chain is always one level deep. */
export const isChainService = (serviceId: string): boolean => Boolean(db.prepare("SELECT 1 FROM chain_sellers WHERE service_id = ?").get(serviceId));

export const listChainsByOwner = (wallet: string): Chain[] =>
  db.prepare("SELECT * FROM chain_sellers WHERE owner = ? ORDER BY created_at DESC").all(wallet.toLowerCase()).map(rowToChain);

// ---- run history ----------------------------------------------------------------------------------------------------

export interface ChainRun {
  serviceId: string;
  /** "sale" = a buyer's request; "test" = the owner's paid test run. */
  kind: "sale" | "test";
  payer?: string;
  /** "ok" = the buyer paid (or the owner's test finished); "failed" = nothing was charged to the buyer. */
  outcome: "ok" | "failed";
  stepsPaid: number;
  stepsCached: number;
  /** Paid to suppliers, in USDC units. */
  cost: bigint;
  /** Brought in by the sale (the price once it settled), in USDC units. */
  earned: bigint;
  error?: string;
  latencyMs: number;
}

const KEEP_RUNS = 500;

export function addChainRun(r: ChainRun) {
  db.prepare(
    `INSERT INTO chain_runs (service_id, ts, kind, payer, outcome, steps_paid, steps_cached, cost_units, earned_units, error, latency_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(r.serviceId, new Date().toISOString(), r.kind, r.payer?.toLowerCase() ?? null, r.outcome, r.stepsPaid, r.stepsCached, r.cost.toString(), r.earned.toString(), r.error?.slice(0, 240) ?? null, Math.round(r.latencyMs));
  db.prepare("DELETE FROM chain_runs WHERE service_id = ? AND id NOT IN (SELECT id FROM chain_runs WHERE service_id = ? ORDER BY id DESC LIMIT ?)").run(r.serviceId, r.serviceId, KEEP_RUNS);
}

export interface ChainStats {
  /** Buyer requests that were paid. */
  calls: number;
  /** Buyer requests that failed (the buyer was not charged). */
  failures: number;
  /** All amounts in USDC units: revenue from sales, supplier cost of every run (failed and test runs included), and the difference. */
  revenue: string;
  cost: string;
  profit: string;
  recent: { ts: string; kind: string; outcome: string; cost: string; earned: string; stepsPaid: number; stepsCached: number; error: string | null }[];
}

/** Totals over the kept history (the last 500 runs) of one chain. */
export function chainStats(serviceId: string): ChainStats {
  const rows = db.prepare("SELECT * FROM chain_runs WHERE service_id = ? ORDER BY id DESC").all(serviceId) as any[];
  let revenue = 0n;
  let cost = 0n;
  let calls = 0;
  let failures = 0;
  for (const r of rows) {
    revenue += BigInt(r.earned_units);
    cost += BigInt(r.cost_units);
    if (r.kind === "sale") r.outcome === "ok" ? calls++ : failures++;
  }
  return {
    calls,
    failures,
    revenue: revenue.toString(),
    cost: cost.toString(),
    profit: (revenue - cost).toString(),
    recent: rows.slice(0, 10).map((r) => ({ ts: r.ts, kind: r.kind, outcome: r.outcome, cost: r.cost_units, earned: r.earned_units, stepsPaid: r.steps_paid, stepsCached: r.steps_cached, error: r.error })),
  };
}

/** Failed settlements by one payer on one seller since `sinceIso`: each one left the seller having paid for a job nobody paid it for. */
export function settleFailures(serviceId: string, payer: string, sinceIso: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM sales WHERE seller = ? AND lower(payer) = ? AND status = 'settle_failed' AND ts > ?").get(serviceId, payer.toLowerCase(), sinceIso) as { n: number };
  return r.n;
}

export function upsertChain(c: Chain) {
  db.prepare(
    `INSERT INTO chain_sellers (service_id, owner, steps_json, sub_budget) VALUES (?,?,?,?)
     ON CONFLICT(service_id) DO UPDATE SET steps_json=excluded.steps_json, sub_budget=excluded.sub_budget`,
  ).run(c.serviceId, c.owner.toLowerCase(), JSON.stringify(c.steps), c.subBudget.toString());
}
