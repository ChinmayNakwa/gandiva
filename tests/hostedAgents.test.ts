import { encodePaymentSignatureHeader } from "@x402/core/http";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loginMessage } from "../src/auth/session.js";
import { config, NETWORK } from "../src/config.js";
import { db } from "../src/db.js";
import { accept } from "./helpers.js";

const fake = vi.hoisted(() => ({ settleCalls: 0 }));

// The paid route runs for real; only the facilitator is faked (requirements follow the route's own payTo and price).
vi.mock("../src/x402/resourceServer.js", async () => {
  const { accept } = await import("./helpers.js");
  return {
    getResourceServer: async () => ({
      buildPaymentRequirements: async (o: any) => accept({ payTo: o.payTo, amount: o.price.amount }),
      createPaymentRequiredResponse: async (reqs: unknown, resource: unknown, error: string) => ({ x402Version: 2, error, resource, accepts: [reqs] }),
      findMatchingRequirements: (reqs: any) => reqs[0] ?? reqs,
      verifyPayment: async () => ({ isValid: true }),
      settlePayment: async () => {
        fake.settleCalls++;
        return { success: true, transaction: "0x" + "ab".repeat(32), network: NETWORK, payer: "0x" + "99".repeat(20) };
      },
    }),
  };
});
// No real DNS: the model host "ollama.com" resolves to a public address, "intranet.example" to a private one.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => [{ address: host.startsWith("intranet") ? "10.0.0.5" : "93.184.216.34", family: 4 }],
}));

const { auth } = await import("../src/auth/routes.js");
const { registry } = await import("../src/registry/routes.js");
const { buildSellers } = await import("../src/sellers/index.js");
const { getHosted } = await import("../src/hosted/agents.js");
const { getService } = await import("../src/registry/store.js");

const ORIGIN = "http://localhost:3000";
const KEY = "ab".repeat(32);
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
// A made-up key, generated per run so no key-like string lives in the repo (gitleaks runs over it).
const OLLAMA_KEY = `test-${generatePrivateKey().slice(2, 26)}`;

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

const agent = (over: Record<string, unknown> = {}) => ({
  name: "pirate-poet",
  description: "Rewrites any text as a short pirate poem.",
  price: "3000",
  host: "https://ollama.com",
  model: "gpt-oss:20b",
  systemPrompt: "You are a pirate poet. Answer in two rhyming lines.",
  apiKey: OLLAMA_KEY,
  ...over,
});
const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  registry.request(path, { method, headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const save = (cookie: string | undefined, body: unknown) => send("POST", "/mine/llm-agents", cookie, body);

// The seller app (hosted route included) mounted the way server.ts mounts it.
const { app: sellersApp } = buildSellers();
const server = new Hono().route("/sellers", sellersApp);

let aliceCookie: string;
let bobCookie: string;
let modelReply: { ok: boolean; status?: number; content?: string };
let modelCalls: { url: string; headers: Record<string, string>; body: any }[];

const paymentHeader = (nonce: string) =>
  encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: accept(),
    payload: { signature: "0x00", authorization: { from: "0x" + "99".repeat(20), to: alice.address, value: "3000", validAfter: "0", validBefore: "9999999999", nonce } },
  } as any);
const ask = (id: string, text: unknown, nonce?: string) =>
  server.request(`/sellers/u/${id}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(nonce ? { "PAYMENT-SIGNATURE": paymentHeader(nonce) } : {}) },
    body: JSON.stringify({ text }),
  });

beforeEach(async () => {
  config.secretsKey = KEY;
  config.ollama.apiKey = "server-wide-key";
  db.exec("DELETE FROM services; DELETE FROM hosted_sellers; DELETE FROM sessions; DELETE FROM auth_nonces; DELETE FROM nonces; DELETE FROM sales");
  fake.settleCalls = 0;
  modelReply = { ok: true, content: "Arr, the sea be wide / and I be full o' pride" };
  modelCalls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: any, init: any = {}) => {
    const url = String(input);
    if (url.endsWith("/api/chat")) {
      modelCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return modelReply.ok
        ? new Response(JSON.stringify({ message: { content: modelReply.content } }), { status: 200 })
        : new Response(`invalid api key ${OLLAMA_KEY}`, { status: modelReply.status ?? 401 });
    }
    // The probe of our own hosted route over loopback.
    return server.request(new URL(url).pathname, init);
  }) as any);
  aliceCookie = await loginCookie(alice);
  bobCookie = await loginCookie(bob);
});
afterEach(() => vi.restoreAllMocks());

describe("LLM agent template: listing", () => {
  it("lists an agent that pays the signed-in wallet and is verified by the registry's own probe", async () => {
    const res = await save(aliceCookie, agent());
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ id: "pirate-poet", category: "inference", method: "POST", payTo: alice.address.toLowerCase(), price: "3000", verification: "verified", hasKey: true });
    expect(body.endpoint).toBe(`${config.publicBaseUrl}/sellers/u/pirate-poet/ask`);
    expect(body.inputSchema.properties.text.description).toBe("Rewrites any text as a short pirate poem.");
  });

  it("stores the API key encrypted and never sends it back", async () => {
    await save(aliceCookie, agent());
    const row = db.prepare("SELECT * FROM hosted_sellers").get() as any;
    expect(JSON.stringify(row)).not.toContain(OLLAMA_KEY);
    expect(row.api_key_enc).toMatch(/^v1:/);
    const mine = await (await send("GET", "/mine", aliceCookie)).text();
    expect(mine).not.toContain(OLLAMA_KEY);
    expect(JSON.parse(mine).agents["pirate-poet"]).toEqual({ host: "https://ollama.com", model: "gpt-oss:20b", systemPrompt: agent().systemPrompt, hasKey: true });
    expect(await (await send("GET", "/services/pirate-poet")).text()).not.toContain(OLLAMA_KEY);
  });

  it("two agents with different descriptions are different jobs for the buyer (different input schemas)", async () => {
    await save(aliceCookie, agent());
    await save(aliceCookie, agent({ name: "legal-summary", description: "Summarises a contract clause in plain English." }));
    expect(JSON.stringify(getService("pirate-poet")!.inputSchema)).not.toBe(JSON.stringify(getService("legal-summary")!.inputSchema));
  });

  it("needs a sign-in and a configured SECRETS_KEY", async () => {
    expect((await save(undefined, agent())).status).toBe(401);
    config.secretsKey = "";
    const res = await save(aliceCookie, agent());
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toMatch(/SECRETS_KEY/);
    expect(getService("pirate-poet")).toBeUndefined();
  });

  it("Ollama cloud needs a key, a custom public host does not", async () => {
    expect((await save(aliceCookie, agent({ apiKey: undefined }))).status).toBe(400);
    expect((await save(aliceCookie, agent({ apiKey: undefined, host: "https://my-ollama.example.org" }))).status).toBe(201);
    expect(getHosted("pirate-poet")).toMatchObject({ host: "https://my-ollama.example.org", apiKeyEnc: null });
  });

  it("rejects private, plain-http and malformed model hosts and bad form values", async () => {
    for (const host of ["https://intranet.example", "http://ollama.com", "https://127.0.0.1", "not a url"]) {
      expect((await save(aliceCookie, agent({ host }))).status, host).toBe(400);
    }
    expect((await save(aliceCookie, agent({ systemPrompt: "" }))).status).toBe(400);
    expect((await save(aliceCookie, agent({ model: "bad model!" }))).status).toBe(400);
    expect((await save(aliceCookie, agent({ description: "short" }))).status).toBe(400);
    expect((await save(aliceCookie, agent({ price: "999999" }))).status).toBe(400);
    expect(getService("pirate-poet")).toBeUndefined();
  });

  it("an edit without a key keeps the stored one; a new key replaces it", async () => {
    await save(aliceCookie, agent());
    const first = getHosted("pirate-poet")!.apiKeyEnc;
    const res = await save(aliceCookie, agent({ apiKey: undefined, systemPrompt: "New prompt.", price: "4000" }));
    expect(res.status).toBe(201);
    expect(getHosted("pirate-poet")).toMatchObject({ apiKeyEnc: first, systemPrompt: "New prompt." });
    expect(getService("pirate-poet")!.price).toBe("4000");
    await save(aliceCookie, agent({ apiKey: "sk-new-key" }));
    expect(getHosted("pirate-poet")!.apiKeyEnc).not.toBe(first);
  });

  it("another wallet cannot take, change or delete the agent; deleting removes its settings", async () => {
    await save(aliceCookie, agent());
    expect((await save(bobCookie, agent({ price: "1" }))).status).toBe(409);
    expect((await send("DELETE", "/mine/services/pirate-poet", bobCookie)).status).toBe(403);
    expect(getHosted("pirate-poet")).toBeDefined();
    expect((await send("DELETE", "/mine/services/pirate-poet", aliceCookie)).status).toBe(200);
    expect(getHosted("pirate-poet")).toBeUndefined();
    expect((await ask("pirate-poet", "hello")).status).toBe(404);
  });

  it("cannot reuse the id of one of your own custom-endpoint listings", async () => {
    await send("POST", "/mine/services", aliceCookie, {
      name: "pirate-poet", category: "data", endpoint: "https://seller.example/x", price: "1500", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    });
    expect((await save(aliceCookie, agent())).status).toBe(409);
  });
});

describe("LLM agent template: the paid route", () => {
  beforeEach(async () => {
    await save(aliceCookie, agent());
  });

  it("asks for payment first, and the 402 pays the seller's wallet the listed price", async () => {
    const res = await ask("pirate-poet", "Describe the sea");
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(modelCalls).toHaveLength(0);
    const pr = (await res.json()) as any;
    expect(pr.accepts[0]).toMatchObject({ payTo: alice.address.toLowerCase(), amount: "3000" });
  });

  it("after payment calls the seller's model with their key, model and system prompt, then settles", async () => {
    const res = await ask("pirate-poet", "Describe the sea", "0x" + "01".repeat(32));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: modelReply.content, model: "gpt-oss:20b" });
    expect(fake.settleCalls).toBe(1);
    expect(modelCalls).toHaveLength(1);
    const call = modelCalls[0];
    expect(call.url).toBe("https://ollama.com/api/chat");
    expect(call.headers.Authorization).toBe(`Bearer ${OLLAMA_KEY}`); // the seller's key, never the server-wide one
    expect(call.body.model).toBe("gpt-oss:20b");
    expect(call.body.messages).toEqual([
      { role: "system", content: agent().systemPrompt },
      { role: "user", content: "Describe the sea" },
    ]);
  });

  it("a custom host never receives the server-wide key", async () => {
    await save(aliceCookie, agent({ name: "keyless", host: "https://my-ollama.example.org", apiKey: undefined }));
    const res = await ask("keyless", "hi", "0x" + "02".repeat(32));
    expect(res.status).toBe(200);
    const call = modelCalls.at(-1)!;
    expect(call.url).toBe("https://my-ollama.example.org/api/chat");
    expect(call.headers.Authorization).toBeUndefined();
  });

  it("charges nothing when the model fails, and the error does not leak the key", async () => {
    modelReply = { ok: false, status: 401 };
    const res = await ask("pirate-poet", "hi", "0x" + "03".repeat(32));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/not charged/);
    expect(text).not.toContain(OLLAMA_KEY);
    expect(fake.settleCalls).toBe(0);
  });

  it("charges nothing when the model returns an empty answer", async () => {
    modelReply = { ok: true, content: "   " };
    const res = await ask("pirate-poet", "hi", "0x" + "04".repeat(32));
    expect(res.status).toBe(502);
    expect(fake.settleCalls).toBe(0);
  });

  it("charges nothing when the stored key can no longer be decrypted", async () => {
    config.secretsKey = "cd".repeat(32);
    const res = await ask("pirate-poet", "hi", "0x" + "05".repeat(32));
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/cannot be read/);
    expect(modelCalls).toHaveLength(0);
    expect(fake.settleCalls).toBe(0);
  });

  it("refuses input that is empty or too long before asking for payment", async () => {
    expect((await ask("pirate-poet", "")).status).toBe(400);
    expect((await ask("pirate-poet", "x".repeat(4001))).status).toBe(400);
  });

  it("an unknown agent is a 404", async () => {
    expect((await ask("no-such-agent", "hi")).status).toBe(404);
  });
});

describe("LLM agent template: free test button", () => {
  const trial = (cookie: string | undefined, over: Record<string, unknown> = {}) =>
    send("POST", "/mine/llm-agents/test", cookie, { text: "Describe the sea", host: "https://ollama.com", model: "gpt-oss:20b", systemPrompt: "Be brief.", apiKey: OLLAMA_KEY, ...over });

  it("runs the form's settings once, with no payment and no listing", async () => {
    const res = await trial(aliceCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: modelReply.content, model: "gpt-oss:20b" });
    expect(modelCalls[0].headers.Authorization).toBe(`Bearer ${OLLAMA_KEY}`);
    expect(fake.settleCalls).toBe(0);
    expect(getService("pirate-poet")).toBeUndefined();
  });

  it("uses the stored key of your own agent when the form leaves it blank, but not someone else's", async () => {
    await save(aliceCookie, agent());
    expect((await trial(aliceCookie, { id: "pirate-poet", apiKey: undefined })).status).toBe(200);
    expect(modelCalls.at(-1)!.headers.Authorization).toBe(`Bearer ${OLLAMA_KEY}`);
    const stolen = await trial(bobCookie, { id: "pirate-poet", apiKey: undefined });
    expect(stolen.status).toBe(400); // Ollama cloud needs a key: Bob gets none
    expect(modelCalls).toHaveLength(1);
  });

  it("reports a model error plainly and needs a sign-in", async () => {
    expect((await trial(undefined)).status).toBe(401);
    modelReply = { ok: false, status: 401 };
    const res = await trial(aliceCookie);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toMatch(/model host answered with an error/);
    expect(text).not.toContain(OLLAMA_KEY);
  });

  it("allows 20 trials per hour per wallet", async () => {
    const carol = await loginCookie(privateKeyToAccount(generatePrivateKey())); // fresh wallet: earlier tests used up Alice's trials
    for (let i = 0; i < 20; i++) expect((await trial(carol)).status).toBe(200);
    expect((await trial(carol)).status).toBe(429);
    expect((await trial(bobCookie)).status).toBe(200);
  });
});
