import { Hono } from "hono";
import { ZodError } from "zod";
import { EXPLORER_TX, fromUnits } from "../config.js";
import { deleteService, getService, listLedger, listSales, reputationFor, searchServices, upsertService } from "./store.js";

export const registry = new Hono();

registry.get("/services", (c) => {
  const { category, maxPrice, sort } = c.req.query();
  return c.json({ services: searchServices({ category, maxPrice, sort }) });
});

registry.get("/services/:id", (c) => {
  const s = getService(c.req.param("id"));
  if (!s) return c.json({ error: "service not found" }, 404);
  return c.json({ ...s, reputation: reputationFor(s.id) });
});

registry.post("/services", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(upsertService(body), 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "invalid listing", issues: err.issues }, 400);
    return c.json({ error: String(err) }, 400);
  }
});

registry.delete("/services/:id", (c) => {
  return deleteService(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "service not found" }, 404);
});

registry.get("/ledger", (c) => {
  const runId = c.req.query("runId");
  const rows = listLedger({ runId }).map((r) => ({
    ...r,
    explorer: r.tx_hash ? EXPLORER_TX + r.tx_hash : null,
    listed_usdc: fromUnits(r.listed),
    asked_usdc: r.asked ? fromUnits(r.asked) : null,
    paid_usdc: fromUnits(r.paid),
  }));
  const charged = rows.filter((r) => r.status === "paid" || r.status === "paid_output_rejected");
  const totalPaid = charged.reduce((acc, r) => acc + BigInt(r.paid), 0n);
  return c.json({ totalPaid: totalPaid.toString(), totalPaidUsdc: fromUnits(totalPaid), entries: rows });
});

registry.get("/sales", (c) => {
  return c.json({
    sales: listSales().map((s) => ({ ...s, explorer: s.tx_hash ? EXPLORER_TX + s.tx_hash : null, amount_usdc: fromUnits(s.amount) })),
  });
});
