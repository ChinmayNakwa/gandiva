import pLimit from "p-limit";
import { randomUUID } from "node:crypto";
import { config, EXPLORER_TX, fromUnits, toUnits } from "../config.js";
import { db } from "../db.js";
import { getService, searchServices, type Category, type ServiceWithReputation } from "../registry/store.js";
import { BudgetLedger } from "../x402/budget.js";
import { SafePayer, type CallResult } from "../x402/safePayer.js";
import { planTask, type TaskPlan } from "./planner.js";

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

export interface RunState {
  id: string;
  task: string;
  budget: string;
  maxConcurrency: number;
  state: "running" | "completed" | "partial" | "needs_more_budget" | "failed";
  log: string[];
  plan?: TaskPlan;
  planner?: string;
  purchases: Purchase[];
  result?: any;
  explanation?: string;
  spent?: string;
  remaining?: string;
  startedAt: string;
  finishedAt?: string;
}

const runs = new Map<string, RunState>();
let payer: SafePayer | null = null;

export function getPayer(): SafePayer {
  if (!config.buyerPrivateKey) throw new Error("BUYER_PRIVATE_KEY is not set; run npm run wallets:new");
  payer ??= new SafePayer(config.buyerPrivateKey);
  return payer;
}

export const getRun = (id: string) => runs.get(id);
export const listRuns = () => [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);

const usd = (u: bigint | string) => fromUnits(u);
const why = (s: ServiceWithReputation, rank: number, total: number) =>
  `rank ${rank}/${total} in ${s.category}: reputation ${(s.reputation.score * 100).toFixed(0)}% (${s.reputation.successes}/${s.reputation.attempts} ok), price ${usd(s.price)} USDC, median latency ${s.reputation.medianLatencyMs ?? "n/a"} ms`;

class Ctx {
  banned = new Set<string>();
  preferred = new Map<Category, string>();
  limit: ReturnType<typeof pLimit>;
  constructor(
    readonly run: RunState,
    readonly budget: BudgetLedger,
    maxConcurrency: number,
  ) {
    this.limit = pLimit(Math.max(1, maxConcurrency));
  }
  log(msg: string) {
    this.run.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  }
}

/**
 * Buy one unit of work in a category: try sellers in reputation order, skipping any that already misbehaved in this run.
 * Price-check refusals, junk output and failures move on to the next seller; budget refusals stop.
 */
async function buy(ctx: Ctx, category: Category, step: string, input: Record<string, unknown>): Promise<{ data?: any; budgetBlocked?: boolean; cheapest?: bigint }> {
  const ranked = searchServices({ category });
  const pref = ctx.preferred.get(category);
  if (pref) ranked.sort((a, b) => (a.id === pref ? -1 : b.id === pref ? 1 : 0));
  const candidates = ranked.filter((s) => !ctx.banned.has(s.id));
  if (!candidates.length) {
    ctx.log(`${step}: no usable ${category} seller left`);
    return {};
  }
  let budgetBlocked = false;
  for (const [i, s] of candidates.entries()) {
    if (budgetBlocked && BigInt(s.price) >= BigInt(candidates[i - 1].price)) continue;
    const reason = why(s, ranked.indexOf(s) + 1, ranked.length);
    let r = await ctx.limit(() => getPayer().call(s, input, { budget: ctx.budget, runId: ctx.run.id }));
    if (r.reason?.startsWith("payment rejected: settlement failed")) {
      ctx.log(`${step}: ${s.name} settlement failed without charging; retrying once with a fresh signature`);
      await new Promise((res) => setTimeout(res, 1000));
      r = await ctx.limit(() => getPayer().call(s, input, { budget: ctx.budget, runId: ctx.run.id }));
    }
    ctx.run.purchases.push({
      step,
      service: s.name,
      serviceId: s.id,
      category,
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
    if (r.ok) {
      ctx.preferred.set(category, s.id);
      return { data: r.data };
    }
    if (r.reason?.startsWith("budget:")) {
      budgetBlocked = true;
      continue;
    }
    if (r.reason?.startsWith("spend cap:")) {
      ctx.log(`${step}: the buyer wallet's spend cap is reached; stopping purchases (${s.name} is not at fault)`);
      return {};
    }
    if (r.status === "unconfirmed") ctx.log(`${step}: ${s.name} payment outcome unknown; budget stays reserved until the chain confirms it`);
    if (r.reason?.startsWith("payment rejected:")) {
      ctx.log(`${step}: our payment was rejected (check the buyer's USDC balance); not blaming ${s.name}`);
      return {};
    }
    ctx.banned.add(s.id);
    if (ctx.preferred.get(category) === s.id) ctx.preferred.delete(category);
  }
  const cheapest = candidates.reduce((m, s) => (BigInt(s.price) < m ? BigInt(s.price) : m), BigInt(candidates[0].price));
  return { budgetBlocked, cheapest };
}

function matchesRating(rating: number, f: TaskPlan["rating"]) {
  if (!f) return true;
  return f.op === "eq" ? rating === f.value : f.op === "gte" ? rating >= f.value : rating <= f.value;
}

function cheapestPrice(category: Category): bigint {
  const list = searchServices({ category });
  return list.length ? list.reduce((m, s) => (BigInt(s.price) < m ? BigInt(s.price) : m), BigInt(list[0].price)) : 0n;
}

export function startTask(opts: { task: string; budget: string; maxConcurrency?: number }): RunState {
  const budgetUnits = toUnits(opts.budget);
  if (budgetUnits <= 0n || budgetUnits > toUnits("1")) throw new Error("budget must be between 0 and 1 USDC");
  const run: RunState = {
    id: randomUUID().slice(0, 8),
    task: opts.task,
    budget: budgetUnits.toString(),
    maxConcurrency: Math.min(Math.max(1, opts.maxConcurrency ?? 3), 10),
    state: "running",
    log: [],
    purchases: [],
    startedAt: new Date().toISOString(),
  };
  runs.set(run.id, run);
  db.prepare("INSERT INTO runs (id, ts, task, budget) VALUES (?,?,?,?)").run(run.id, run.startedAt, run.task, run.budget);
  executeTask(run).catch((err) => {
    run.state = "failed";
    run.log.push(`fatal: ${err?.message ?? err}`);
    run.finishedAt = new Date().toISOString();
  });
  return run;
}

async function executeTask(run: RunState) {
  const budget = new BudgetLedger(BigInt(run.budget));
  const ctx = new Ctx(run, budget, run.maxConcurrency);
  ctx.log(`budget ${usd(run.budget)} USDC, max_concurrency ${run.maxConcurrency}, buyer ${getPayer().address}`);

  const { plan, planner, notes } = await planTask(run.task);
  run.plan = plan;
  run.planner = planner;
  notes.forEach((n) => ctx.log(n));
  ctx.log(`plan (${planner}): ${JSON.stringify(plan)}`);

  const pages = Array.from({ length: plan.pages.to - plan.pages.from + 1 }, (_, i) => plan.pages.from + i);
  const needFx = plan.currency !== "GBP";
  const summaryCalls = plan.summarise ? Math.ceil(plan.limit / 2) : 0;
  const estimate = BigInt(pages.length) * cheapestPrice("scraping") + (needFx ? cheapestPrice("data") : 0n) + BigInt(summaryCalls) * cheapestPrice("inference");
  ctx.log(
    `quote: ${pages.length} page scrape(s) + ${needFx ? 1 : 0} FX call + ${summaryCalls} summary call(s) (2 texts per call) >= ${usd(estimate)} USDC at the cheapest listed prices`,
  );
  if (estimate > budget.budget) ctx.log(`warning: budget ${usd(budget.budget)} is below the cheapest possible cost ${usd(estimate)}; buying what fits, then stopping`);

  const fxPromise = needFx ? buy(ctx, "data", `fx GBP->${plan.currency}`, { from: "GBP", to: plan.currency }) : Promise.resolve({ data: { rate: 1, from: "GBP", to: "GBP", date: "" } });

  // Probe the first page alone so a bad seller is discovered once, then fan out in parallel.
  const pageResults: Record<number, any> = {};
  let blocked = false;
  const scrapePage = async (p: number) => {
    const r = await buy(ctx, "scraping", `scrape page ${p}`, { page: p });
    if (r.data) pageResults[p] = r.data;
    if (r.budgetBlocked) blocked = true;
  };
  await scrapePage(pages[0]);
  await Promise.all(pages.slice(1).map(scrapePage));
  const fx = await fxPromise;
  if ((fx as any).budgetBlocked) blocked = true;

  const gotPages = pages.filter((p) => pageResults[p]);
  const missingPages = pages.filter((p) => !pageResults[p]);
  const books = gotPages.flatMap((p) => pageResults[p].books as any[]);
  const picked = books
    .filter((b) => matchesRating(b.rating, plan.rating))
    .sort((a, b) => (plan.sort === "asc" ? a.price_gbp - b.price_gbp : b.price_gbp - a.price_gbp))
    .slice(0, plan.limit);
  const rate: number | undefined = fx.data?.rate;
  ctx.log(`combined ${books.length} books from ${gotPages.length} page(s); ${picked.length} match the filter`);

  const summaries: (string | null)[] = picked.map(() => null);
  let summaryCallsDone = 0;
  if (plan.summarise && picked.length) {
    const chunks: number[][] = [];
    for (let i = 0; i < picked.length; i += 2) chunks.push([i, i + 1].filter((j) => j < picked.length));
    await Promise.all(
      chunks.map(async (idx, n) => {
        const texts = idx.map((j) => (picked[j].description || picked[j].title).slice(0, 6000));
        const r = await buy(ctx, "inference", `hindi summary batch ${n + 1}`, { texts });
        if (r.budgetBlocked) blocked = true;
        if (r.data?.summaries) {
          summaryCallsDone++;
          idx.forEach((j, k) => (summaries[j] = r.data.summaries[k]?.summary ?? null));
        }
      }),
    );
  }

  run.result = {
    currency: plan.currency,
    fxRate: rate ?? null,
    fxDate: fx.data?.date ?? null,
    pagesScraped: gotPages,
    pagesMissing: missingPages,
    books: picked.map((b, i) => ({
      title: b.title,
      rating: b.rating,
      price_gbp: b.price_gbp,
      [`price_${plan.currency.toLowerCase()}`]: rate !== undefined ? Math.round(b.price_gbp * rate * 100) / 100 : null,
      url: b.url,
      summary_hi: summaries[i],
    })),
  };

  run.spent = budget.spent.toString();
  run.remaining = (budget.budget - budget.spent).toString();
  const incomplete = missingPages.length > 0 || rate === undefined || (plan.summarise && summaries.some((s) => s === null));
  if (blocked) {
    const remainingCost =
      BigInt(missingPages.length) * cheapestPrice("scraping") +
      (needFx && rate === undefined ? cheapestPrice("data") : 0n) +
      BigInt(Math.max(0, summaryCalls - summaryCallsDone)) * cheapestPrice("inference");
    const shortfall = remainingCost > budget.budget - budget.spent ? remainingCost - (budget.budget - budget.spent) : 0n;
    run.state = "needs_more_budget";
    ctx.log(`stopped: budget exhausted. Spent ${usd(budget.spent)} of ${usd(budget.budget)} USDC. Need about ${usd(shortfall > 0n ? shortfall : remainingCost)} USDC more to finish.`);
  } else run.state = incomplete ? "partial" : "completed";

  run.explanation = explain(run, plan);
  run.finishedAt = new Date().toISOString();
  db.prepare("UPDATE runs SET result = ? WHERE id = ?").run(JSON.stringify({ state: run.state, result: run.result, purchases: run.purchases }), run.id);
  ctx.log(`done: ${run.state}. spent ${usd(run.spent)} USDC, ${usd(run.remaining)} left`);
}

function explain(run: RunState, plan: TaskPlan): string {
  const lines: string[] = [];
  const paid = run.purchases.filter((p) => p.status === "paid" || p.status === "paid_output_rejected");
  lines.push(
    `Task: ${plan.sort === "asc" ? "cheapest" : "most expensive"} ${plan.limit} book(s)${plan.rating ? ` with rating ${plan.rating.op === "eq" ? "=" : plan.rating.op === "gte" ? ">=" : "<="} ${plan.rating.value}` : ""} on pages ${plan.pages.from}-${plan.pages.to}, priced in ${plan.currency}${plan.summarise ? ", with Hindi summaries" : ""}.`,
  );
  lines.push(`Outcome: ${run.state}. Spent ${usd(run.spent ?? "0")} of ${usd(run.budget)} USDC across ${paid.length} paid call(s); ${usd(run.remaining ?? run.budget)} USDC left.`);
  for (const p of run.purchases) {
    const money = p.status === "paid" || p.status === "paid_output_rejected" ? `paid ${usd(p.paid)} USDC (tx ${p.txHash ?? "n/a"})` : p.status === "unconfirmed" ? `payment unconfirmed (up to ${usd(p.asked ?? p.listed)} USDC, counted against the budget until the chain settles it)` : "paid nothing";
    lines.push(`- ${p.step}: ${p.service} [${p.status}] ${money}. Why: ${p.why}.${p.reason ? ` Note: ${p.reason}.` : ""}`);
  }
  if (plan.summarise) lines.push(`Summaries were batched 2 texts per call (${Math.ceil(plan.limit / 2)} call(s) instead of ${plan.limit}) to save budget.`);
  return lines.join("\n");
}

/** Buy one call in a category with reputation-ranked failover (e.g. junk output -> next seller). */
export async function buyCategory(opts: { category: Category; input: Record<string, unknown>; budget: string; maxConcurrency?: number }) {
  const run: RunState = {
    id: `buy-${randomUUID().slice(0, 6)}`,
    task: `buy ${opts.category} ${JSON.stringify(opts.input)}`,
    budget: toUnits(opts.budget).toString(),
    maxConcurrency: opts.maxConcurrency ?? 1,
    state: "running",
    log: [],
    purchases: [],
    startedAt: new Date().toISOString(),
  };
  runs.set(run.id, run);
  const budget = new BudgetLedger(BigInt(run.budget));
  const r = await buy(new Ctx(run, budget, run.maxConcurrency), opts.category, `buy ${opts.category}`, opts.input);
  run.state = r.data ? "completed" : r.budgetBlocked ? "needs_more_budget" : "failed";
  run.spent = budget.spent.toString();
  run.remaining = (budget.budget - budget.spent).toString();
  run.result = r.data ?? null;
  run.finishedAt = new Date().toISOString();
  return run;
}

/** Direct paid call to any registry service (used by judge tests and interop with external sellers). */
export async function buyOnce(opts: { serviceId: string; input: Record<string, unknown>; budget: string; timeoutMs?: number }) {
  const service = getService(opts.serviceId);
  if (!service) throw new Error(`service ${opts.serviceId} not found`);
  const budget = new BudgetLedger(toUnits(opts.budget));
  // A short timeout lets tests provoke "no answer after signing"; clamp so a caller cannot disable the safety net.
  const timeoutMs = opts.timeoutMs ? Math.min(Math.max(opts.timeoutMs, 1_000), 90_000) : undefined;
  const r = await getPayer().call(service, opts.input, { budget, runId: `direct-${randomUUID().slice(0, 6)}`, timeoutMs });
  return { ...r, paid: r.paid.toString(), asked: r.asked?.toString(), explorer: r.txHash ? EXPLORER_TX + r.txHash : undefined };
}
