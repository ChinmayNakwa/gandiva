import { x402Client } from "@x402/core/client";
import { MCP_PAYMENT_META_KEY, MCP_PAYMENT_RESPONSE_META_KEY } from "@x402/mcp";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK, USDC_ADDRESS } from "../src/config.js";
import { db } from "../src/db.js";
import { SELLER } from "./helpers.js";

// The real x402 resource server and @x402/mcp wrapper, backed by a fake facilitator (no chain, no network).
const fake = vi.hoisted(() => ({ verifyCalls: 0, settleCalls: 0 }));
vi.mock("../src/x402/resourceServer.js", async () => {
  const { x402ResourceServer } = await import("@x402/core/server");
  const { registerExactEvmScheme } = await import("@x402/evm/exact/server");
  const { NETWORK } = await import("../src/config.js");
  const facilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} }),
    verify: async (p: any) => (fake.verifyCalls++, { isValid: true, payer: p.payload.authorization.from }),
    settle: async (p: any) => (fake.settleCalls++, { success: true, transaction: "0x" + "ab".repeat(32), network: NETWORK, payer: p.payload.authorization.from }),
  };
  const server = new x402ResourceServer(facilitator as any);
  registerExactEvmScheme(server, { networks: [NETWORK] });
  const ready = server.initialize().then(() => server);
  return { getResourceServer: () => ready };
});

vi.mock("../src/sellers/index.js", async () => {
  const { ServiceError } = await import("../src/x402/paidRoute.js");
  const { SELLER } = await import("./helpers.js");
  const fxInput = { type: "object", required: ["from", "to"], properties: { from: { type: "string", pattern: "^[A-Z]{3}$" }, to: { type: "string" } } };
  const fxOutput = { type: "object", required: ["rate"], properties: { rate: { type: "number" } } };
  const def = (over: Record<string, unknown>) => ({ path: "/x", method: "GET", category: "data", listedPrice: 1000n, payTo: SELLER, inputSchema: fxInput, outputSchema: fxOutput, description: "test", ...over });
  return {
    activeSellerDefs: () => [
      def({ id: "test-fx", name: "test-fx", handler: async () => ({ rate: 1.25 }) }),
      def({ id: "broken-fx", name: "broken-fx", handler: async () => Promise.reject(new ServiceError("upstream down")) }),
      def({ id: "junk-fx", name: "junk-fx", adversarial: true, handler: async () => ({ rate: "lots" }) }),
    ],
  };
});

const { mcp } = await import("../src/mcp/server.js");

let id = 0;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await mcp.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return ((await res.json()) as any).result;
}
const call = (name: string, args: Record<string, unknown>, payment?: unknown) => rpc("tools/call", { name, arguments: args, ...(payment ? { _meta: { [MCP_PAYMENT_META_KEY]: payment } } : {}) });

const buyer = privateKeyToAccount(generatePrivateKey());
const payClient = new x402Client();
registerExactEvmScheme(payClient, { signer: buyer, networks: [NETWORK] });
/** Ask for the 402, then sign it with a real EIP-3009 authorisation, as an off-the-shelf x402 MCP client would. */
async function signedPayment(tool: string, args: Record<string, unknown>) {
  const unpaid = await call(tool, args);
  return payClient.createPaymentPayload(unpaid.structuredContent);
}
const sales = () => db.prepare("SELECT seller, status, amount FROM sales ORDER BY id").all() as any[];

beforeEach(() => {
  fake.verifyCalls = 0;
  fake.settleCalls = 0;
  db.exec("DELETE FROM nonces; DELETE FROM sales;");
});

describe("paid MCP tools", () => {
  it("lists the free tools and the honest sellers, never the demo bad actors", async () => {
    const names = (await rpc("tools/list")).tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_services", "get_reputation", "test_fx", "broken_fx"]));
    expect(names).not.toContain("junk_fx");
  });

  it("an unpaid call gets a standard x402 v2 payment request at the listed price and payTo", async () => {
    const r = await call("test_fx", { from: "GBP", to: "INR" });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ x402Version: 2, accepts: [{ scheme: "exact", network: NETWORK, amount: "1000", asset: USDC_ADDRESS, payTo: SELLER }] });
    expect(fake.settleCalls).toBe(0);
  });

  it("a paid call runs the tool, settles once and records the sale", async () => {
    const payment = await signedPayment("test_fx", { from: "GBP", to: "INR" });
    const r = await call("test_fx", { from: "GBP", to: "INR" }, payment);
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toEqual({ rate: 1.25 });
    expect(r._meta[MCP_PAYMENT_RESPONSE_META_KEY]).toMatchObject({ success: true, transaction: "0x" + "ab".repeat(32) });
    expect(fake.settleCalls).toBe(1);
    expect(sales()).toEqual([{ seller: "test-fx", status: "paid", amount: "1000" }]);
  });

  it("replay: the same authorisation a second time gets nothing and settles nothing", async () => {
    const payment = await signedPayment("test_fx", { from: "GBP", to: "INR" });
    await call("test_fx", { from: "GBP", to: "INR" }, payment);
    const again = await call("test_fx", { from: "GBP", to: "INR" }, payment);
    expect(again.isError).toBe(true);
    expect(again.content[0].text).not.toContain("rate\":1.25");
    expect(fake.settleCalls).toBe(1);
    expect(sales().map((s) => s.status)).toEqual(["paid", "replay_rejected"]);
  });

  it("parallel replay: five copies at once, exactly one result and one settlement", async () => {
    const payment = await signedPayment("test_fx", { from: "GBP", to: "INR" });
    const results = await Promise.all(Array.from({ length: 5 }, () => call("test_fx", { from: "GBP", to: "INR" }, payment)));
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(fake.settleCalls).toBe(1);
  });

  it("no service, no charge: a failing tool is not settled and its authorisation is freed", async () => {
    const payment = await signedPayment("broken_fx", { from: "GBP", to: "INR" });
    const r = await call("broken_fx", { from: "GBP", to: "INR" }, payment);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not charged: upstream down/);
    expect(fake.settleCalls).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM nonces").get()).toEqual({ n: 0 });
    expect(sales().map((s) => s.status)).toEqual(["failed_not_charged"]);
  });

  it("bad input is refused before any payment is asked for", async () => {
    const r = await call("test_fx", { from: "pounds" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/invalid input/);
    expect(r.structuredContent).toBeUndefined();
  });

  it("free tools need no payment", async () => {
    const r = await call("get_reputation", { id: "does-not-exist" });
    expect(r.content[0].text).toMatch(/no service/);
    expect(fake.verifyCalls).toBe(0);
  });
});
