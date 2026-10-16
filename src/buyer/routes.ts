import { Hono } from "hono";
import { AgentWalletError, getAgentPayer, usdcBalance } from "../agents/wallet.js";
import { currentUser } from "../auth/routes.js";
import { config, fromUnits, toUnits } from "../config.js";
import { buyCategory, buyOnce, getRun, listRuns, startTask } from "./scout.js";

export const buyer = new Hono();

// The optional buyer token guards the shared demo wallet. Only /run pays from a signed-in user's own agent wallet, so only
// there may a signed-in user skip it; /buy and /call always pay from the shared wallet.
buyer.use("/*", async (c, next) => {
  const ownWallet = c.req.path.endsWith("/run") && currentUser(c);
  if (c.req.method !== "GET" && config.buyerToken && !ownWallet && c.req.header("x-buyer-token") !== config.buyerToken) {
    return c.json({ error: "missing or wrong x-buyer-token" }, 401);
  }
  await next();
});

buyer.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.task || typeof body.task !== "string") return c.json({ error: "task (string) is required" }, 400);
  const budget = String(body.budget ?? "0.05");
  const dryRun = body.dryRun === true || body.dry_run === true;
  try {
    // Signed in: the run pays from this user's own agent wallet, and only if it holds enough. Otherwise: the shared demo wallet.
    const user = currentUser(c);
    let payer;
    if (user) {
      payer = getAgentPayer(user);
      if (!dryRun) {
        const held = await usdcBalance(payer.address);
        if (held < toUnits(budget)) {
          return c.json({ error: `Your agent wallet holds ${fromUnits(held)} USDC but this run's budget is ${budget} USDC. Add funds to your agent wallet on the Run page or lower the budget.` }, 400);
        }
      }
    }
    const run = startTask({
      task: body.task,
      budget,
      maxConcurrency: Number(body.maxConcurrency ?? body.max_concurrency ?? 3),
      dryRun,
      mode: ["agent", "legacy", "auto"].includes(body.mode) ? body.mode : undefined,
      payer,
      owner: user ?? undefined,
    });
    return c.json({ runId: run.id, status: `/buyer/runs/${run.id}` }, 202);
  } catch (err: any) {
    if (err instanceof AgentWalletError) return c.json({ error: err.message }, err.status);
    return c.json({ error: err?.message ?? String(err) }, 400);
  }
});

buyer.get("/runs", (c) => c.json({ runs: listRuns().map(({ id, task, state, startedAt, spent, budget }) => ({ id, task, state, startedAt, spent, budget })) }));

buyer.get("/runs/:id", (c) => {
  const run = getRun(c.req.param("id"));
  return run ? c.json(run) : c.json({ error: "run not found" }, 404);
});

buyer.post("/buy", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!["data", "inference", "scraping"].includes(body.category)) return c.json({ error: "category must be data, inference or scraping" }, 400);
  try {
    return c.json(await buyCategory({ category: body.category, input: body.input ?? {}, budget: String(body.budget ?? "0.05") }));
  } catch (err: any) {
    return c.json({ error: err?.message ?? String(err) }, 400);
  }
});

buyer.post("/call", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.serviceId) return c.json({ error: "serviceId is required" }, 400);
  try {
    return c.json(await buyOnce({ serviceId: body.serviceId, input: body.input ?? {}, budget: String(body.budget ?? "0.1"), timeoutMs: Number(body.timeoutMs) || undefined }));
  } catch (err: any) {
    return c.json({ error: err?.message ?? String(err) }, 400);
  }
});
