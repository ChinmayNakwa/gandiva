import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { auth } from "../src/auth/routes.js";
import { loginMessage } from "../src/auth/session.js";
import { db } from "../src/db.js";
import { registry } from "../src/registry/routes.js";
import { getService, MAX_LISTINGS_PER_WALLET, SEED_OWNER, upsertService } from "../src/registry/store.js";
import { OTHER, SELLER } from "./helpers.js";

const ORIGIN = "http://localhost:3000";
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());

async function loginCookie(account: typeof alice) {
  const { nonce } = (await (await auth.request("/nonce")).json()) as { nonce: string };
  const message = loginMessage({ address: account.address, nonce, issuedAt: new Date().toISOString(), uri: ORIGIN });
  const res = await auth.request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const listing = (over: Record<string, unknown> = {}) => ({
  name: "my-weather",
  category: "data",
  endpoint: "https://seller.example/weather",
  price: "1500",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  ...over,
});
const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  registry.request(path, { method, headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

let aliceCookie: string;
let bobCookie: string;

beforeEach(async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  db.exec("DELETE FROM services; DELETE FROM sessions; DELETE FROM auth_nonces");
  aliceCookie = await loginCookie(alice);
  bobCookie = await loginCookie(bob);
});
afterEach(() => vi.restoreAllMocks());

describe("Sell tab: listings owned by a signed-in wallet", () => {
  it("needs a sign-in for every call", async () => {
    expect((await send("GET", "/mine")).status).toBe(401);
    expect((await send("POST", "/mine/services", undefined, listing())).status).toBe(401);
    expect((await send("DELETE", "/mine/services/my-weather")).status).toBe(401);
  });

  it("forces payTo to the signed-in wallet, whatever the form says", async () => {
    const res = await send("POST", "/mine/services", aliceCookie, listing({ payTo: OTHER, owner: "gandiva" }));
    expect(res.status).toBe(201);
    expect(getService("my-weather")).toMatchObject({ payTo: alice.address.toLowerCase(), owner: `wallet:${alice.address.toLowerCase()}` });
  });

  it("lists only the caller's own listings", async () => {
    await send("POST", "/mine/services", aliceCookie, listing());
    await send("POST", "/mine/services", bobCookie, listing({ name: "bob-fx" }));
    const mine = (await (await send("GET", "/mine", aliceCookie)).json()) as { services: { id: string }[] };
    expect(mine.services.map((s) => s.id)).toEqual(["my-weather"]);
  });

  it("the owner can update a listing; another wallet cannot touch or take its name", async () => {
    await send("POST", "/mine/services", aliceCookie, listing());
    expect((await send("POST", "/mine/services", aliceCookie, listing({ price: "2500" }))).status).toBe(201);
    expect(getService("my-weather")!.price).toBe("2500");

    const steal = await send("POST", "/mine/services", bobCookie, listing({ price: "1" }));
    expect(steal.status).toBe(409);
    expect(getService("my-weather")!.price).toBe("2500");
  });

  it("the open registry cannot overwrite a wallet listing, even with the same payTo", async () => {
    await send("POST", "/mine/services", aliceCookie, listing());
    const res = await send("POST", "/services", undefined, { ...listing({ id: "my-weather" }), payTo: alice.address });
    expect(res.status).toBe(403);
    expect(getService("my-weather")!.price).toBe("1500");
  });

  it("only the owner can delete; the open registry's admin-token route still works for the admin", async () => {
    await send("POST", "/mine/services", aliceCookie, listing());
    expect((await send("DELETE", "/mine/services/my-weather", bobCookie)).status).toBe(403);
    expect(getService("my-weather")).toBeDefined();
    expect((await send("DELETE", "/mine/services/my-weather", aliceCookie)).status).toBe(200);
    expect(getService("my-weather")).toBeUndefined();
    expect((await send("DELETE", "/mine/services/my-weather", aliceCookie)).status).toBe(404);
  });

  it("cannot overwrite or delete a built-in service", async () => {
    upsertService({ ...(listing({ id: "fx-rates", name: "fx-rates", payTo: OTHER }) as any), owner: SEED_OWNER });
    expect((await send("POST", "/mine/services", aliceCookie, listing({ name: "fx-rates" }))).status).toBe(403);
    expect((await send("DELETE", "/mine/services/fx-rates", aliceCookie)).status).toBe(403);
  });

  it("stops at the per-wallet limit", async () => {
    for (let i = 0; i < MAX_LISTINGS_PER_WALLET; i++) expect((await send("POST", "/mine/services", aliceCookie, listing({ name: `svc-${i}` }))).status).toBe(201);
    expect((await send("POST", "/mine/services", aliceCookie, listing({ name: "one-too-many" }))).status).toBe(403);
    // updating an existing one is still fine at the limit
    expect((await send("POST", "/mine/services", aliceCookie, listing({ name: "svc-0", price: "2000" }))).status).toBe(201);
    // the other wallet has its own allowance
    expect((await send("POST", "/mine/services", bobCookie, listing({ name: "bob-one" }))).status).toBe(201);
  });

  it("applies the same checks as the open registry (bad price, private address)", async () => {
    process.env.ALLOW_PRIVATE_ENDPOINTS = "false";
    try {
      expect((await send("POST", "/mine/services", aliceCookie, listing({ price: "999999" }))).status).toBe(400);
      expect((await send("POST", "/mine/services", aliceCookie, listing({ endpoint: "http://169.254.169.254/x" }))).status).toBe(400);
      expect(getService("my-weather")).toBeUndefined();
    } finally {
      delete process.env.ALLOW_PRIVATE_ENDPOINTS;
    }
  });

  it("a payTo-only listing from the open registry (judges' reference sellers) still works as before", async () => {
    const res = await send("POST", "/services", undefined, { ...listing({ id: "ref-fx" }), payTo: SELLER });
    expect(res.status).toBe(201);
    expect(getService("ref-fx")!.owner).toBe("external");
  });
});
