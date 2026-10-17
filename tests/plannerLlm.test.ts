import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loginMessage } from "../src/auth/session.js";
import { config } from "../src/config.js";
import { db } from "../src/db.js";

const chain = vi.hoisted(() => ({ balance: 5_000_000n }));
const scout = vi.hoisted(() => ({ startTask: vi.fn() }));

vi.mock("../src/x402/chain.js", () => ({ chainClient: () => ({ readContract: async () => chain.balance }) }));
vi.mock("../src/buyer/scout.js", () => ({
  startTask: scout.startTask,
  buyCategory: vi.fn(),
  buyOnce: vi.fn(),
  getRun: vi.fn(),
  listRuns: () => [],
  getPayer: () => ({ address: "0x" + "dd".repeat(20) }),
  hasActiveRun: () => false,
}));
// No real DNS: "ollama.com" resolves to a public address, "intranet.example" to a private one.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => [{ address: host.startsWith("intranet") ? "10.0.0.5" : "93.184.216.34", family: 4 }],
}));

const { auth } = await import("../src/auth/routes.js");
const { agent } = await import("../src/agents/routes.js");
const { buyer } = await import("../src/buyer/routes.js");
const { chatWith } = await import("../src/llm.js");

const ORIGIN = "http://localhost:3000";
const KEY = "ab".repeat(32);
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
// Made-up keys generated per run so no key-like string lives in the repo (gitleaks runs over it).
const ALICE_KEY = `test-${generatePrivateKey().slice(2, 26)}`;
const SERVER_KEY = `test-${generatePrivateKey().slice(2, 26)}`;

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
const send = (method: string, cookie?: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const fetchMock = vi.fn();
let aliceCookie: string;
let bobCookie: string;

/** Ollama answers "ok" unless the test says otherwise. */
const ollamaOk = () => fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 }));

beforeEach(async () => {
  config.secretsKey = KEY;
  config.buyerToken = "";
  config.ollama.apiKey = SERVER_KEY;
  chain.balance = 5_000_000n;
  scout.startTask.mockReset();
  scout.startTask.mockReturnValue({ id: "run12345" });
  fetchMock.mockReset();
  ollamaOk();
  vi.stubGlobal("fetch", fetchMock);
  db.exec("DELETE FROM users; DELETE FROM sessions; DELETE FROM auth_nonces; DELETE FROM withdrawals; DELETE FROM ledger");
  aliceCookie = await loginCookie(alice);
  bobCookie = await loginCookie(bob);
});
afterEach(() => vi.unstubAllGlobals());

describe("a user's own Ollama key for Scout's planning", () => {
  it("needs a sign-in", async () => {
    expect((await agent.request("/llm", send("PUT", undefined, { apiKey: ALICE_KEY }))).status).toBe(401);
    expect((await agent.request("/llm", send("DELETE"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is checked with one tiny call using the user's key, then stored encrypted and never shown again", async () => {
    const res = await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY, model: "gpt-oss:20b" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ host: "https://ollama.com", model: "gpt-oss:20b", hasKey: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://ollama.com/api/chat");
    expect(init.headers.Authorization).toBe(`Bearer ${ALICE_KEY}`);

    const stored = db.prepare("SELECT llm_key_enc FROM users WHERE address = ?").get(alice.address.toLowerCase()) as { llm_key_enc: string };
    expect(stored.llm_key_enc).toMatch(/^v1:/);
    expect(stored.llm_key_enc).not.toContain(ALICE_KEY);

    const info = await (await agent.request("/", send("GET", aliceCookie))).text();
    expect(info).toContain('"hasKey":true');
    expect(info).not.toContain(ALICE_KEY);
    expect(info).not.toContain(stored.llm_key_enc);
  });

  it("is saved only if the check works; a failure stores nothing and never echoes the key", async () => {
    fetchMock.mockImplementation(async () => new Response(`bad key ${ALICE_KEY}`, { status: 401 }));
    const res = await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("did not work");
    expect(text).not.toContain(ALICE_KEY);
    expect((db.prepare("SELECT llm_key_enc FROM users WHERE address = ?").get(alice.address.toLowerCase()) as any).llm_key_enc).toBeNull();
  });

  it("asks for a key on Ollama cloud and refuses private or non-https hosts without calling them", async () => {
    expect((await agent.request("/llm", send("PUT", aliceCookie, {}))).status).toBe(400);
    expect((await agent.request("/llm", send("PUT", aliceCookie, { host: "https://intranet.example", apiKey: ALICE_KEY }))).status).toBe(400);
    expect((await agent.request("/llm", send("PUT", aliceCookie, { host: "http://ollama.com", apiKey: ALICE_KEY }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the stored key when only the model changes, and each user's settings are their own", async () => {
    await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY, model: "model-a" }));
    const res = await agent.request("/llm", send("PUT", aliceCookie, { model: "model-b" }));
    expect(await res.json()).toEqual({ host: "https://ollama.com", model: "model-b", hasKey: true });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${ALICE_KEY}`);

    const bobInfo = (await (await agent.request("/", send("GET", bobCookie))).json()) as any;
    expect(bobInfo.plannerLlm).toBeNull();
  });

  it("removing it puts the user back on the server's key", async () => {
    await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY }));
    expect((await agent.request("/llm", send("DELETE", aliceCookie))).status).toBe(200);
    expect(((await (await agent.request("/", send("GET", aliceCookie))).json()) as any).plannerLlm).toBeNull();
    const run = await buyer.request("/run", send("POST", aliceCookie, { task: "hello", budget: "0.01", dryRun: true }));
    expect(run.status).toBe(202);
    expect(scout.startTask.mock.calls[0][0].llm).toBeUndefined();
  });

  it("limits how often settings can be saved", async () => {
    const { savePlannerLlm } = await import("../src/agents/llm.js");
    const stranger = privateKeyToAccount(generatePrivateKey()).address; // its own counter, so other tests are unaffected
    const t = Date.now();
    for (let i = 0; i < 20; i++) await savePlannerLlm({ apiKey: ALICE_KEY }, stranger, t);
    await expect(savePlannerLlm({ apiKey: ALICE_KEY }, stranger, t)).rejects.toThrow(/at most 20/);
  });
});

describe("runs use the signed-in user's key for planning", () => {
  it("a saved key goes to startTask for that user only", async () => {
    await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY, model: "mine" }));
    await buyer.request("/run", send("POST", aliceCookie, { task: "hello", budget: "0.01", dryRun: true }));
    expect(scout.startTask.mock.calls[0][0].llm).toEqual({ host: "https://ollama.com", model: "mine", apiKey: ALICE_KEY });

    await buyer.request("/run", send("POST", bobCookie, { task: "hello", budget: "0.01", dryRun: true }));
    expect(scout.startTask.mock.calls[1][0].llm).toBeUndefined();
    await buyer.request("/run", send("POST", undefined, { task: "hello", budget: "0.01", dryRun: true }));
    expect(scout.startTask.mock.calls[2][0].llm).toBeUndefined();
  });

  it("a key that can no longer be decrypted stops the run with a clear message instead of using the server's key", async () => {
    await agent.request("/llm", send("PUT", aliceCookie, { apiKey: ALICE_KEY }));
    config.secretsKey = "cd".repeat(32);
    const res = await buyer.request("/run", send("POST", aliceCookie, { task: "hello", budget: "0.01", dryRun: true }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toMatch(/save it again/);
    expect(scout.startTask).not.toHaveBeenCalled();
  });

  it("chatWith sends the user's key and never the server's; without settings it uses the server's", async () => {
    const mine = { host: "https://ollama.com", model: "m", apiKey: ALICE_KEY };
    await chatWith(mine, { json: true })([{ role: "user", content: "hi" }]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${ALICE_KEY}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("m");

    await chatWith(undefined, { json: true })([{ role: "user", content: "hi" }]);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${SERVER_KEY}`);
  });

  it("a planning failure message never contains the user's key", async () => {
    fetchMock.mockImplementation(async () => new Response(`denied for ${ALICE_KEY}`, { status: 403 }));
    const err = await chatWith({ host: "https://ollama.com", model: "m", apiKey: ALICE_KEY }, {})([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(String(err.message)).toContain("403");
    expect(String(err.message)).not.toContain(ALICE_KEY);
  });
});
