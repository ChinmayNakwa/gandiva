import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config, NETWORK, USDC_ADDRESS } from "./config.js";
import { buyer } from "./buyer/routes.js";
import { getPayer } from "./buyer/scout.js";
import { llmAvailable } from "./llm.js";
import { registry } from "./registry/routes.js";
import { buildSellers, seedRegistry } from "./sellers/index.js";
import { getResourceServer } from "./x402/resourceServer.js";

const app = new Hono();
app.use("*", cors({ origin: "*", exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: "internal error" }, 500);
});

const { app: sellers, active } = buildSellers();
app.route("/registry", registry);
app.route("/sellers", sellers);
app.route("/buyer", buyer);

app.get("/api/info", async (c) => {
  let buyerAddress: string | null = null;
  try {
    buyerAddress = getPayer().address;
  } catch {}
  return c.json({
    network: NETWORK,
    asset: USDC_ADDRESS,
    facilitator: config.facilitatorUrl,
    publicBaseUrl: config.publicBaseUrl,
    buyer: buyerAddress,
    sellers: active.map((s) => ({ id: s.id, payTo: s.payTo, endpoint: `${config.publicBaseUrl}/sellers/${s.id}${s.path}`, adversarial: !!s.adversarial })),
    llm: { host: config.ollama.host.replace(/\/\/.*@/, "//"), model: config.ollama.model, available: await llmAvailable() },
    buyerTokenRequired: Boolean(config.buyerToken),
  });
});

app.get("/healthz", (c) => c.json({ ok: true }));
app.use("/*", serveStatic({ root: "./public" }));

seedRegistry(active);
serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Gandiva running on http://localhost:${config.port}  (public: ${config.publicBaseUrl})`);
  console.log(`  dashboard  ${config.publicBaseUrl}/`);
  console.log(`  registry   ${config.publicBaseUrl}/registry/services`);
  for (const s of active) console.log(`  seller     ${config.publicBaseUrl}/sellers/${s.id}${s.path}${s.adversarial ? "  (demo bad actor)" : ""}`);
  try {
    console.log(`  buyer      ${getPayer().address}`);
  } catch (err: any) {
    console.warn(`  buyer      not configured: ${err.message}`);
  }
});

getResourceServer()
  .then(() => console.log(`  facilitator ${config.facilitatorUrl} ready`))
  .catch((err) => console.error(`  facilitator init failed: ${err.message}`));
