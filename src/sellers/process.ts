// One seller as its own process: its own port, its own SQLite file (nonces and sales), and the same public URL path
// (/sellers/<id>/...) the main server forwards to it. Started by the main server (see supervisor.ts) or by hand:
//   SELLER_ID=shelf-scraper SELLER_PORT=4100 DB_PATH=data/sellers/shelf-scraper.db tsx src/sellers/process.ts
// It listens on loopback only; the public front door never exposes this port directly.
import "dotenv/config";

const id = process.env.SELLER_ID;
const port = Number(process.env.SELLER_PORT);
if (!id || !Number.isInteger(port) || port < 1) {
  console.error("SELLER_ID and SELLER_PORT are required");
  process.exit(1);
}
process.env.DB_PATH ||= `data/sellers/${id}.db`;
// db.ts creates only data/; make sure the seller folder exists before it opens the file.
const { mkdirSync } = await import("node:fs");
const { dirname } = await import("node:path");
mkdirSync(dirname(process.env.DB_PATH), { recursive: true });

const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
const { activeSellerDefs, mountSeller } = await import("./index.js");
const { listSales } = await import("../registry/store.js");

const def = activeSellerDefs().find((d) => d.id === id);
if (!def) {
  console.error(`seller "${id}" is unknown, or its payTo address is not configured`);
  process.exit(1);
}

const app = new Hono();
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: "internal error" }, 500);
});
const sellers = new Hono();
mountSeller(sellers, def);
app.route("/sellers", sellers);
app.get("/healthz", (c) => c.json({ ok: true, seller: id }));
// Internal only: the main server collects this seller's receipts here for /registry/sales and reconcile.
app.get("/_sales", (c) => c.json({ sales: listSales(Math.min(Number(c.req.query("limit")) || 500, 2000)) }));

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => console.log(`${id} ready on 127.0.0.1:${port} (db ${process.env.DB_PATH})`));

// When the main server goes away (even if it is killed), so do we.
process.on("disconnect", () => process.exit(0));
