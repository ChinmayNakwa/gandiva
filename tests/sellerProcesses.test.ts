import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Seller wallets are read when config loads, so set them before the app modules are imported.
vi.hoisted(() => {
  const addr = (n: number) => `0x${String(n).repeat(40)}`;
  const keys = ["SHELF_SCRAPER", "CHEAP_SCRAPER", "FX_RATES", "HINDI_SUMMARY", "CITY_INFO", "SENTIMENT", "JUNK_FX", "MIRROR_SCRAPER", "ATTACKER", "PROMO_SCRAPER"];
  keys.forEach((k, i) => (process.env[`PAYTO_${k}`] = addr(i + 1)));
  process.env.SEED_ADVERSARIAL = "true";
});

import { Hono } from "hono";
import { getService, upsertService } from "../src/registry/store.js";
import { activeSellerDefs, buildSellers, seedRegistry } from "../src/sellers/index.js";
import { service } from "./helpers.js";
import { forwardTo } from "../src/sellers/proxy.js";
import { collectSales } from "../src/sellers/supervisor.js";

/** A stand-in for a seller process: records what it receives and answers like a paid route would. */
function fakeSeller() {
  const seen: { method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      if (req.url!.startsWith("/_sales")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ sales: [{ id: 1, ts: "2026-01-01T00:00:02.000Z", seller: "fx-rates", amount: "1000", status: "paid" }] }));
      }
      if (!req.headers["payment-signature"]) {
        res.writeHead(402, { "content-type": "application/json", "payment-required": "challenge-token" });
        return res.end(JSON.stringify({ error: "pay first" }));
      }
      res.writeHead(200, { "content-type": "application/json", "payment-response": "receipt-token" });
      res.end(JSON.stringify({ ok: true, echoed: body }));
    });
  });
  return { server, seen, start: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port))) };
}

const seller = fakeSeller();
let port = 0;
beforeAll(async () => {
  port = await seller.start();
});
afterAll(() => {
  seller.server.close();
});

const hub = (target: string) => {
  const app = new Hono();
  app.all("/sellers/fx-rates/*", forwardTo(target, "/sellers"));
  return app;
};

describe("forwarding to a seller process", () => {
  it("passes the 402 challenge, its headers and the query string through", async () => {
    const res = await hub(`http://127.0.0.1:${port}`).request("/sellers/fx-rates/rate?from=GBP&to=INR");
    expect(res.status).toBe(402);
    expect(res.headers.get("payment-required")).toBe("challenge-token");
    expect(await res.json()).toEqual({ error: "pay first" });
    expect(seller.seen.at(-1)).toMatchObject({ method: "GET", url: "/sellers/fx-rates/rate?from=GBP&to=INR" });
  });

  it("passes the payment signature and a POST body in, and the receipt header out", async () => {
    const res = await hub(`http://127.0.0.1:${port}`).request("/sellers/fx-rates/rate", { method: "POST", headers: { "PAYMENT-SIGNATURE": "sig", "content-type": "application/json" }, body: '{"a":1}' });
    expect(res.status).toBe(200);
    expect(res.headers.get("payment-response")).toBe("receipt-token");
    expect(await res.json()).toEqual({ ok: true, echoed: '{"a":1}' });
    expect(seller.seen.at(-1)!.headers["payment-signature"]).toBe("sig");
  });

  it("answers 502 'not charged' when the seller process is down", async () => {
    const res = await hub("http://127.0.0.1:1").request("/sellers/fx-rates/rate?from=GBP&to=INR");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ charged: false });
  });
});

describe("buildSellers with separate processes", () => {
  it("forwards remote sellers and serves the others in-process", async () => {
    const { app, active } = buildSellers(new Map([["fx-rates", port]]));
    expect(active.map((d) => d.id)).toEqual(activeSellerDefs().map((d) => d.id));
    const remote = await app.request("/fx-rates/rate?from=GBP&to=INR");
    expect(remote.status).toBe(402);
    expect(remote.headers.get("payment-required")).toBe("challenge-token"); // came from the fake process
    const local = await app.request("/city-info/city?name=Tokyo"); // served by this process: asks for payment itself
    expect(local.status).toBe(402);
    expect(local.headers.get("payment-required")).not.toBe("challenge-token");
  });
});

describe("collectSales", () => {
  it("merges local and remote receipts newest first, renumbers ids and skips an unreachable seller", async () => {
    const local = [{ id: 1, ts: "2026-01-01T00:00:01.000Z", seller: "shelf-scraper", amount: "5000", status: "paid" }, { id: 2, ts: "2026-01-01T00:00:03.000Z", seller: "shelf-scraper", amount: "0", status: "replay_rejected" }];
    const merged = await collectSales(local, new Map([["fx-rates", port], ["down", 1]]));
    expect(merged.map((s) => [s.ts.slice(17, 19), s.seller])).toEqual([["03", "shelf-scraper"], ["02", "fx-rates"], ["01", "shelf-scraper"]]);
    expect(merged.map((s) => s.id)).toEqual([3, 2, 1]);
  });
  it("respects the limit", async () => {
    expect(await collectSales([], new Map([["fx-rates", port]]), 0)).toEqual([]);
  });
});

describe("seedRegistry", () => {
  it("drops built-in listings whose seller is switched off, and leaves other listings alone", () => {
    const all = activeSellerDefs();
    upsertService(service({ id: "someone-elses", name: "someone-elses", owner: "external" }));
    seedRegistry(all);
    expect(getService("junk-fx")).toBeDefined();
    seedRegistry(all.filter((d) => !d.adversarial)); // SEED_ADVERSARIAL=false
    expect(getService("junk-fx")).toBeUndefined();
    expect(getService("fx-rates")?.owner).toBe("gandiva");
    expect(getService("someone-elses")).toBeDefined();
  });
});
