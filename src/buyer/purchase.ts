import pLimit from "p-limit";
import { EXPLORER_TX, fromUnits } from "../config.js";
import type { Category, Service, ServiceWithReputation } from "../registry/store.js";
import type { BudgetLedger } from "../x402/budget.js";
import type { CallResult } from "../x402/safePayer.js";
import type { TaskPlan } from "./planner.js";

export interface Purchase {
  step: string;
  service: string;
  serviceId: string;
  category: Category;
  seller: string;
  why: string;
  status: CallResult["status"];
  listed: string;
  asked?: string;
  paid: string;
  txHash?: string;
  explorer?: string;
  reason?: string;
  latencyMs: number;
}

export interface QuoteLine {
  turn: number;
  as: string;
  service: string;
  category: Category;
  estimate: string;
  purpose?: string;
  input: unknown;
}

/** What a dry run would cost: the planned paid calls priced at each group's best-ranked seller. */
export interface Quote {
  lines: QuoteLine[];
  total: string;
  byCategory: Partial<Record<Category, string>>;
  note: string;
}

export interface RunState {
  id: string;
  task: string;
  budget: string;
  maxConcurrency: number;
  state: "running" | "completed" | "partial" | "needs_more_budget" | "failed";
  /** agent = the LLM plans in rounds; legacy = the built-in books pipeline (used as a fallback). */
  mode: "agent" | "legacy";
  dryRun: boolean;
  /** Wallet that pays for this run: the signed-in user's agent wallet, or the shared demo wallet. */
  buyer?: string;
  /** Signed-in user (lower-case wallet address) who started the run; absent for the shared demo wallet. */
  owner?: string;
  log: string[];
  plan?: TaskPlan;
  planner?: string;
  purchases: Purchase[];
  result?: any;
  quote?: Quote;
  explanation?: string;
  spent?: string;
  remaining?: string;
  startedAt: string;
  finishedAt?: string;
}

export type PayFn = (service: Service, input: Record<string, unknown>, ctx: { budget: BudgetLedger; runId?: string }) => Promise<CallResult>;

export const usd = (u: bigint | string) => fromUnits(u);

export class Ctx {
  banned = new Set<string>();
  preferred = new Map<string, string>();
  /** Set when the wallet itself cannot pay any more (spend cap, rejected payment); later calls are skipped. */
  halted?: string;
  limit: ReturnType<typeof pLimit>;
  constructor(
    readonly run: RunState,
    readonly budget: BudgetLedger,
    maxConcurrency: number,
    readonly pay: PayFn,
  ) {
    this.limit = pLimit(Math.max(1, maxConcurrency));
  }
  log(msg: string) {
    this.run.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  }
}

/** One line of the human-readable explanation for a purchase attempt. */
export function describePurchase(p: Purchase): string {
  const money =
    p.status === "paid" || p.status === "paid_output_rejected"
      ? `paid ${usd(p.paid)} USDC (tx ${p.txHash ?? "n/a"})`
      : p.status === "unconfirmed"
        ? `payment unconfirmed (up to ${usd(p.asked ?? p.listed)} USDC, counted against the budget until the chain settles it)`
        : "paid nothing";
  return `- ${p.step}: ${p.service} [${p.status}] ${money}. Why: ${p.why}.${p.reason ? ` Note: ${p.reason}.` : ""}`;
}

const why = (s: ServiceWithReputation, rank: number, total: number) =>
  `rank ${rank}/${total} in ${s.category}: reputation ${(s.reputation.score * 100).toFixed(0)}% (${s.reputation.successes}/${s.reputation.attempts} ok), price ${usd(s.price)} USDC, median latency ${s.reputation.medianLatencyMs ?? "n/a"} ms`;

export interface BuyOutcome {
  data?: any;
  budgetBlocked?: boolean;
  cheapest?: bigint;
  /** Why buying stopped without data, when it was not the seller's fault or the budget. */
  stop?: "spend_cap" | "payment_rejected" | "no_seller";
  /** Seller that delivered `data`. */
  service?: string;
  lastReason?: string;
}

/**
 * Buy one unit of work from a pool of interchangeable sellers: try them in reputation order, skipping any that already
 * misbehaved in this run. Price-check refusals, junk output and failures move on to the next seller; budget refusals stop.
 * `poolKey` scopes the "preferred seller" memory (a category for the legacy pipeline, a service group for the agent).
 */
export async function buyFrom(ctx: Ctx, poolKey: string, ranked: ServiceWithReputation[], step: string, input: Record<string, unknown>): Promise<BuyOutcome> {
  const pref = ctx.preferred.get(poolKey);
  const ordered = pref ? [...ranked].sort((a, b) => (a.id === pref ? -1 : b.id === pref ? 1 : 0)) : ranked;
  const candidates = ordered.filter((s) => !ctx.banned.has(s.id));
  if (!candidates.length) {
    ctx.log(`${step}: no usable ${poolKey} seller left`);
    return { stop: "no_seller" };
  }
  let budgetBlocked = false;
  let lastReason: string | undefined;
  for (const [i, s] of candidates.entries()) {
    if (budgetBlocked && BigInt(s.price) >= BigInt(candidates[i - 1].price)) continue;
    const reason = why(s, ranked.indexOf(s) + 1, ranked.length);
    let r = await ctx.limit(() => ctx.pay(s, input, { budget: ctx.budget, runId: ctx.run.id }));
    if (r.reason?.startsWith("payment rejected: settlement failed")) {
      ctx.log(`${step}: ${s.name} settlement failed without charging; retrying once with a fresh signature`);
      await new Promise((res) => setTimeout(res, 1000));
      r = await ctx.limit(() => ctx.pay(s, input, { budget: ctx.budget, runId: ctx.run.id }));
    }
    ctx.run.purchases.push({
      step,
      service: s.name,
      serviceId: s.id,
      category: s.category,
      seller: s.payTo,
      why: reason,
      status: r.status,
      listed: s.price,
      asked: r.asked?.toString(),
      paid: r.paid.toString(),
      txHash: r.txHash,
      explorer: r.txHash ? EXPLORER_TX + r.txHash : undefined,
      reason: r.reason,
      latencyMs: r.latencyMs,
    });
    ctx.log(`${step}: ${s.name} -> ${r.status}${r.paid ? ` (${usd(r.paid)} USDC)` : ""}${r.reason ? ` - ${r.reason}` : ""}`);
    lastReason = r.reason ?? lastReason;
    if (r.ok) {
      ctx.preferred.set(poolKey, s.id);
      return { data: r.data, service: s.name };
    }
    if (r.reason?.startsWith("budget:")) {
      budgetBlocked = true;
      continue;
    }
    if (r.reason?.startsWith("spend cap:")) {
      ctx.log(`${step}: the buyer wallet's spend cap is reached; stopping purchases (${s.name} is not at fault)`);
      ctx.halted = r.reason;
      return { stop: "spend_cap", lastReason };
    }
    if (r.status === "unconfirmed") ctx.log(`${step}: ${s.name} payment outcome unknown; budget stays reserved until the chain confirms it`);
    if (r.reason?.startsWith("payment rejected:")) {
      ctx.log(`${step}: our payment was rejected (check the buyer's USDC balance); not blaming ${s.name}`);
      ctx.halted = r.reason;
      return { stop: "payment_rejected", lastReason };
    }
    ctx.banned.add(s.id);
    if (ctx.preferred.get(poolKey) === s.id) ctx.preferred.delete(poolKey);
  }
  const cheapest = candidates.reduce((m, s) => (BigInt(s.price) < m ? BigInt(s.price) : m), BigInt(candidates[0].price));
  return { budgetBlocked, cheapest, lastReason };
}
