import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { currentUser } from "../auth/routes.js";
import { config, EXPLORER_TX, fromUnits } from "../config.js";
import { listWithdrawals } from "../agents/wallet.js";
import { listHostedFor } from "../hosted/agents.js";
import { hostedRoutes } from "../hosted/routes.js";
import { collectSales, sellerPorts } from "../sellers/supervisor.js";
import { stakeRoutes } from "../stake/routes.js";
import { endpointBlockedReason, verifyService } from "./probe.js";
import { deleteOwnedService, deleteService, getService, listByOwner, listLedger, listSales, RegistryError, registerExternal, registerForWallet, reputationFor, searchServices } from "./store.js";

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

// Signed-in sellers (Sell tab): list, update and delete their own listings. payTo is always the signed-in wallet.
const signedIn = (c: Context) => currentUser(c);

registry.get("/mine", (c) => {
  const me = signedIn(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  return c.json({ address: me, services: listByOwner(me).map((s) => ({ ...s, reputation: reputationFor(s.id) })), agents: listHostedFor(me) });
});

registry.route("/mine/llm-agents", hostedRoutes);
registry.route("/stake", stakeRoutes);

registry.post(
  "/mine/services",
  bodyLimit({ maxSize: MAX_LISTING_BYTES, onError: (c) => c.json({ error: `listing too large (max ${MAX_LISTING_BYTES} bytes)` }, 413) }),
  async (c) => {
    const me = signedIn(c);
    if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
    try {
      const body = await c.req.json();
      const blocked = typeof body?.endpoint === "string" ? await endpointBlockedReason(body.endpoint) : null;
      if (blocked) return c.json({ error: blocked }, 400);
      const listed = registerForWallet(body, me);
      await verifyService(listed);
      return c.json(getService(listed.id), 201);
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: "invalid listing", issues: err.issues }, 400);
      if (err instanceof RegistryError) return c.json({ error: err.message }, err.status);
      return c.json({ error: "body must be valid JSON" }, 400);
    }
  },
);

registry.delete("/mine/services/:id", (c) => {
  const me = signedIn(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  const result = deleteOwnedService(c.req.param("id"), me);
  if (result === "deleted") return c.json({ ok: true });
  return result === "not_yours" ? c.json({ error: "this listing belongs to another wallet" }, 403) : c.json({ error: "service not found" }, 404);
});

registry.delete("/services/:id", (c) => {
  if (!config.adminToken) return c.json({ error: "deleting listings is disabled (ADMIN_TOKEN is not set)" }, 403);
  if (!safeEqual(c.req.header("x-admin-token") ?? "", config.adminToken)) return c.json({ error: "missing or wrong x-admin-token" }, 401);
  return deleteService(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "service not found" }, 404);
});

registry.get("/ledger", (c) => {
  const runId = c.req.query("runId");
  const rows = listLedger({ runId, buyer: c.req.query("buyer") }).map((r) => ({
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

// Money taken back out of agent wallets (outgoing transfers that are not seller payments); scripts/reconcile.ts needs them.
registry.get("/withdrawals", (c) => c.json({ withdrawals: listWithdrawals(c.req.query("buyer")) }));

registry.get("/sales", async (c) => {
  const rows = sellerPorts.size ? await collectSales(listSales(), sellerPorts) : listSales();
  return c.json({
    sales: rows.map((s) => ({ ...s, explorer: s.tx_hash ? EXPLORER_TX + s.tx_hash : null, amount_usdc: fromUnits(s.amount) })),
  });
});
