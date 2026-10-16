import { Hono } from "hono";
import { config } from "../config.js";
import { buyCategory, buyOnce, getRun, listRuns, startTask } from "./scout.js";

export const buyer = new Hono();

buyer.use("/*", async (c, next) => {
  if (c.req.method !== "GET" && config.buyerToken && c.req.header("x-buyer-token") !== config.buyerToken) {
    return c.json({ error: "missing or wrong x-buyer-token" }, 401);
  }
  await next();
});

buyer.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.task || typeof body.task !== "string") return c.json({ error: "task (string) is required" }, 400);
  try {
    const run = startTask({ task: body.task, budget: String(body.budget ?? "0.05"), maxConcurrency: Number(body.maxConcurrency ?? body.max_concurrency ?? 3) });
    return c.json({ runId: run.id, status: `/buyer/runs/${run.id}` }, 202);
  } catch (err: any) {
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
    return c.json(await buyOnce({ serviceId: body.serviceId, input: body.input ?? {}, budget: String(body.budget ?? "0.1") }));
  } catch (err: any) {
    return c.json({ error: err?.message ?? String(err) }, 400);
  }
});
