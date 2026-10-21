import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { registry } from "../src/registry/routes.js";
import { getService, SEED_OWNER, upsertService } from "../src/registry/store.js";
import { OTHER, SELLER } from "./helpers.js";

const listing = (over: Record<string, unknown> = {}) => ({
  id: "ref-fx",
  name: "ref-fx",
  category: "data",
  endpoint: "https://seller.example/fx",
  method: "GET",
  price: "1000",
  payTo: SELLER,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  ...over,
});
const post = (body: unknown, raw = false) =>
  registry.request("/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });
const del = (id: string, token?: string) => registry.request(`/services/${id}`, { method: "DELETE", headers: token ? { "x-admin-token": token } : {} });

beforeEach(() => {
  // Listing probes the endpoint; keep these tests off the network (the probe tests cover its outcomes).
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  db.exec("DELETE FROM services");
  config.adminToken = "test-admin-token";
  upsertService({ ...(listing({ id: "fx-rates", name: "fx-rates", payTo: OTHER }) as any), owner: SEED_OWNER });
});

afterEach(() => vi.restoreAllMocks());

describe("registry: open registration for judges' reference sellers", () => {
  it("anyone can list a new seller", async () => {
    const res = await post(listing());
    expect(res.status).toBe(201);
    expect(getService("ref-fx")).toMatchObject({ payTo: SELLER, price: "1000" });
  });

  it("the caller cannot claim the built-in owner", async () => {
    await post(listing({ owner: SEED_OWNER }));
    expect(getService("ref-fx")!.owner).toBe("external");
  });

  it("built-in marketplace services cannot be overwritten, even with their own payTo", async () => {
    const res = await post(listing({ id: "fx-rates", payTo: OTHER, price: "1", endpoint: "https://evil.example/fx" }));
    expect(res.status).toBe(403);
    expect(getService("fx-rates")!.endpoint).not.toContain("evil");
  });

  it("another party cannot take over an existing listing, but the original payTo can update it", async () => {
    await post(listing());
    expect((await post(listing({ payTo: OTHER, endpoint: "https://evil.example/fx" }))).status).toBe(409);
    expect(getService("ref-fx")!.endpoint).toBe("https://seller.example/fx");
    expect((await post(listing({ price: "2000" }))).status).toBe(201);
    expect(getService("ref-fx")!.price).toBe("2000");
  });

  it("rejects invalid listings (price above the 0.10 USDC cap, bad address, wrong category)", async () => {
    expect((await post(listing({ price: "100001" }))).status).toBe(400);
    expect((await post(listing({ payTo: "0x123" }))).status).toBe(400);
    expect((await post(listing({ category: "weather" }))).status).toBe(400);
  });

  it("rejects payloads that are not JSON", async () => {
    expect((await post("not json", true)).status).toBe(400);
  });

  it("rejects oversized payloads", async () => {
    const res = await post(listing({ description: "x".repeat(10), inputSchema: { type: "object", junk: "y".repeat(40_000) } }));
    expect(res.status).toBe(413);
  });
});

describe("registry: deleting needs the admin token", () => {
  beforeEach(async () => {
    await post(listing());
  });

  it("refuses without a token and with the wrong token", async () => {
    expect((await del("ref-fx")).status).toBe(401);
    expect((await del("ref-fx", "wrong")).status).toBe(401);
    expect(getService("ref-fx")).toBeDefined();
  });

  it("deletes with the right token", async () => {
    expect((await del("ref-fx", "test-admin-token")).status).toBe(200);
    expect(getService("ref-fx")).toBeUndefined();
    expect((await del("ref-fx", "test-admin-token")).status).toBe(404);
  });

  it("is disabled entirely when no ADMIN_TOKEN is configured", async () => {
    config.adminToken = "";
    expect((await del("ref-fx", "")).status).toBe(403);
    expect((await del("ref-fx", "anything")).status).toBe(403);
    expect(getService("ref-fx")).toBeDefined();
  });
});

describe("registry: errors are reported for what they are", () => {
  const post = (body: string) => registry.request("/services", { method: "POST", headers: { "Content-Type": "application/json" }, body });

  it("a bad maxPrice is a 400, not a crash", async () => {
    expect((await registry.request("/services?maxPrice=abc")).status).toBe(400);
    expect((await registry.request("/services?maxPrice=0.01")).status).toBe(400);
    expect((await registry.request("/services?maxPrice=5000")).status).toBe(200);
  });

  it("only broken JSON is called broken JSON; a database failure is a 500", async () => {
    const bad = await post("{not json");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/valid JSON/);

    vi.spyOn(console, "error").mockImplementation(() => {});
    db.exec("CREATE TEMP TRIGGER services_write_fails BEFORE INSERT ON services BEGIN SELECT RAISE(ABORT, 'database is locked'); END;");
    try {
      const listing = { id: "db-down", name: "db-down", category: "data", endpoint: "https://x.test/a", price: "1000", payTo: SELLER, inputSchema: {}, outputSchema: {} };
      expect((await post(JSON.stringify(listing))).status).toBe(500);
    } finally {
      db.exec("DROP TRIGGER services_write_fails");
    }
  });
});
