// A reference seller built only from the unmodified x402 v2 SDK (@x402/express middleware), like the judges' one.
// CLI: npm run interop:ref-seller -- [port] [priceUSD] [payTo]   -> registers itself in the registry as "ref-fx".
import "dotenv/config";
import express from "express";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { api } from "../lib.js";

export interface RefSellerOptions {
  port: number;
  /** Price the 402 actually asks, e.g. "$0.001" */
  price: string;
  /** payTo the 402 actually names */
  payTo: string;
  /** Return schema-breaking output with status 200 */
  junk?: boolean;
}

export async function startRefSeller(o: RefSellerOptions): Promise<{ url: string; close: () => void }> {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL || "https://x402.org/facilitator" }));
  registerExactEvmScheme(server);
  const app = express();
  app.use(
    paymentMiddleware(
      {
        "GET /rate": {
          accepts: { scheme: "exact", price: o.price, network: "eip155:84532", payTo: o.payTo },
          description: "Reference FX seller (standard @x402/express)",
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
  app.get("/rate", (req, res) => {
    if (o.junk) return void res.json({ oops: "not a rate", rate: "high" });
    res.json({ from: String(req.query.from ?? "GBP").toUpperCase(), to: String(req.query.to ?? "INR").toUpperCase(), rate: 111.11, date: new Date().toISOString().slice(0, 10), source: "reference" });
  });
  const http: Server = await new Promise((resolve) => {
    const s = app.listen(o.port, () => resolve(s));
  });
  return { url: `http://localhost:${o.port}/rate`, close: () => http.close() };
}

export const fxSchemas = {
  inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
  outputSchema: { type: "object", required: ["from", "to", "rate", "date"], properties: { from: { type: "string" }, to: { type: "string" }, rate: { type: "number", exclusiveMinimum: 0 }, date: { type: "string" } } },
};

export async function registerRef(id: string, url: string, priceUnits: string, payTo: string, description: string) {
  return api("/registry/services", { id, name: id, category: "data", endpoint: url, method: "GET", price: priceUnits, payTo, ...fxSchemas, description, owner: "reference" });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [port = "4100", price = "$0.001", payTo = process.env.PAYTO_ATTACKER || ""] = process.argv.slice(2);
  const ref = await startRefSeller({ port: Number(port), price, payTo });
  const units = String(Math.round(Number(price.replace("$", "")) * 1e6));
  await registerRef("ref-fx", ref.url, units, payTo, "Reference seller using unmodified @x402/express");
  console.log(`reference seller on ${ref.url} (asks ${price} to ${payTo}), registered as ref-fx`);
  console.log(`Now let our buyer pay it:\n  curl -X POST ${process.env.GANDIVA_URL || "http://localhost:4021"}/buyer/call -H "Content-Type: application/json" -d '{"serviceId":"ref-fx","input":{"from":"GBP","to":"INR"}}'`);
}
