import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { config, EXPLORER_TX, fromUnits } from "../config.js";
import { collectSales, sellerPorts } from "../sellers/supervisor.js";
import { endpointBlockedReason, verifyService } from "./probe.js";
import { deleteService, getService, listLedger, listSales, RegistryError, registerExternal, reputationFor, searchServices } from "./store.js";

export const registry = new Hono();

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

registry.get("/services", (c) => {
  const { category, maxPrice, sort } = c.req.query();
  return c.json({ services: searchServices({ category, maxPrice, sort }) });
});

registry.get("/services/:id", (c) => {
  const s = getService(c.req.param("id"));
  if (!s) return c.json({ error: "service not found" }, 404);
  return c.json({ ...s, reputation: reputationFor(s.id) });
});

const MAX_LISTING_BYTES = 32 * 1024;

registry.post(
  "/services",
  bodyLimit({ maxSize: MAX_LISTING_BYTES, onError: (c) => c.json({ error: `listing too large (max ${MAX_LISTING_BYTES} bytes)` }, 413) }),
  async (c) => {
    try {
      const body = await c.req.json();
      const blocked = typeof body?.endpoint === "string" ? await endpointBlockedReason(body.endpoint) : null;
      if (blocked) return c.json({ error: blocked }, 400);
      const listed = registerExternal(body);
      // The listing is accepted either way; the probe records whether its real 402 matches (see Verification).
      await verifyService(listed);
      return c.json(getService(listed.id), 201);
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: "invalid listing", issues: err.issues }, 400);
      if (err instanceof RegistryError) return c.json({ error: err.message }, err.status);
      return c.json({ error: "body must be valid JSON" }, 400);
    }
  },
);

registry.delete("/services/:id", (c) => {
  if (!config.adminToken) return c.json({ error: "deleting listings is disabled (ADMIN_TOKEN is not set)" }, 403);
  if (!safeEqual(c.req.header("x-admin-token") ?? "", config.adminToken)) return c.json({ error: "missing or wrong x-admin-token" }, 401);
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
  const unconfirmed = rows.filter((r) => r.status === "unconfirmed");
  return c.json({ totalPaid: totalPaid.toString(), totalPaidUsdc: fromUnits(totalPaid), unconfirmedCount: unconfirmed.length, entries: rows });
});

registry.get("/sales", async (c) => {
  const rows = sellerPorts.size ? await collectSales(listSales(), sellerPorts) : listSales();
  return c.json({
    sales: rows.map((s) => ({ ...s, explorer: s.tx_hash ? EXPLORER_TX + s.tx_hash : null, amount_usdc: fromUnits(s.amount) })),
  });
});
