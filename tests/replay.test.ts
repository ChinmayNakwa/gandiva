import { encodePaymentSignatureHeader } from "@x402/core/http";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, NETWORK, USDC_ADDRESS } from "../src/config.js";
import { db } from "../src/db.js";
import { decodeReceipt, outputHash, RECEIPT_HEADER, receiptSignerOf, requestHash, schemaHash } from "../src/stake/receipt.js";
import { accept, SELLER } from "./helpers.js";

// A fake facilitator-backed resource server: the unit under test is our paidRoute ordering (claim nonce -> verify -> run -> settle).
const fake = vi.hoisted(() => ({ settleCalls: 0, verifyCalls: 0, settleDelayMs: 20, verifyOk: true }));

vi.mock("../src/x402/resourceServer.js", () => ({
  getResourceServer: async () => ({
    buildPaymentRequirements: async () => accept(),
    createPaymentRequiredResponse: async (reqs: unknown, resource: unknown, error: string) => ({ x402Version: 2, error, resource, accepts: [reqs] }),
    findMatchingRequirements: () => accept(),
    verifyPayment: async () => {
      fake.verifyCalls++;
      return fake.verifyOk ? { isValid: true } : { isValid: false, invalidReason: "bad_signature" };
    },
    settlePayment: async () => {
      fake.settleCalls++;
      await new Promise((r) => setTimeout(r, fake.settleDelayMs));
      return { success: true, transaction: "0x" + "ab".repeat(32), network: NETWORK, payer: "0x" + "99".repeat(20) };
    },
  }),
}));

const { paidRoute, ServiceError } = await import("../src/x402/paidRoute.js");

const payment = (nonce: string) =>
  encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: accept(),
    payload: { signature: "0x00", authorization: { from: "0x" + "99".repeat(20), to: SELLER, value: "1000", validAfter: "0", validBefore: "9999999999", nonce } },
  } as any);

function makeApp(handler: () => Promise<unknown>) {
  const app = new Hono();
  app.get(
    "/fx",
    paidRoute({
      seller: "test-seller",
      description: "fx",
      price: 1000n,
      payTo: SELLER,
      inputSchema: { type: "object" },
      outputSchema: { type: "object", required: ["rate"], properties: { rate: { type: "number" } } },
      handler: handler as any,
    }),
  );
  return app;
}
const call = (app: Hono, nonce?: string) => app.request("/fx", nonce ? { headers: { "PAYMENT-SIGNATURE": payment(nonce) } } : {});

beforeEach(() => {
  fake.settleCalls = 0;
  fake.verifyCalls = 0;
  fake.verifyOk = true;
  db.exec("DELETE FROM nonces; DELETE FROM sales;");
});

describe("seller: one authorisation unlocks exactly one response", () => {
  const nonce = (n: number) => "0x" + n.toString(16).padStart(64, "0");

  it("asks for payment when no signature is sent", async () => {
    const res = await call(makeApp(async () => ({ rate: 1 })));
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    expect(fake.settleCalls).toBe(0);
  });

  it("serial replay: second use of the same authorisation gets 409 and settles nothing", async () => {
    const app = makeApp(async () => ({ rate: 1 }));
    const first = await call(app, nonce(1));
    const second = await call(app, nonce(1));
    expect(first.status).toBe(200);
    expect(first.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(second.status).toBe(409);
    expect(fake.settleCalls).toBe(1);
  });

  it("parallel replay: 5 simultaneous uses give exactly one success and one settlement", async () => {
    const app = makeApp(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { rate: 1 };
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => call(app, nonce(2))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(fake.settleCalls).toBe(1);
    const sales = db.prepare("SELECT status FROM sales").all() as { status: string }[];
    expect(sales.filter((s) => s.status === "paid")).toHaveLength(1);
    expect(sales.filter((s) => s.status === "replay_rejected")).toHaveLength(4);
  });

  it("different authorisations are independent", async () => {
    const app = makeApp(async () => ({ rate: 1 }));
    const results = await Promise.all([call(app, nonce(3)), call(app, nonce(4))]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(fake.settleCalls).toBe(2);
  });
});

describe("seller: no service, no charge", () => {
  const nonce = (n: number) => "0x" + (n + 100).toString(16).padStart(64, "0");

  it("a failing handler returns an error, never settles, and frees the authorisation", async () => {
    let fail = true;
    const app = makeApp(async () => {
      if (fail) throw new ServiceError("upstream is down", 503);
      return { rate: 2 };
    });
    const res = await call(app, nonce(1));
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).charged).toBe(false);
    expect(fake.settleCalls).toBe(0);
    fail = false;
    expect((await call(app, nonce(1))).status).toBe(200);
    expect(fake.settleCalls).toBe(1);
  });

  it("output that breaks the listed schema is not settled", async () => {
    const res = await call(makeApp(async () => ({ rate: "high" })), nonce(2));
    expect(res.status).toBe(502);
    expect(fake.settleCalls).toBe(0);
  });

  it("a handler that exceeds the timeout is not settled", async () => {
    const app = new Hono();
    app.get(
      "/slow",
      paidRoute({ seller: "slow", description: "slow", price: 1000n, payTo: SELLER, inputSchema: { type: "object" }, outputSchema: { type: "object" }, timeoutMs: 30, handler: () => new Promise((r) => setTimeout(r, 500)) }),
    );
    const res = await app.request("/slow", { headers: { "PAYMENT-SIGNATURE": payment(nonce(3)) } });
    expect(res.status).toBe(504);
    expect(fake.settleCalls).toBe(0);
  });

  it("a payment that fails verification is bounced with a fresh 402 and never settles", async () => {
    fake.verifyOk = false;
    const res = await call(makeApp(async () => ({ rate: 1 })), nonce(4));
    expect(res.status).toBe(402);
    expect(fake.settleCalls).toBe(0);
  });
});

describe("seller: signed receipt on a paid response", () => {
  const nonce = (n: number) => "0x" + (n + 200).toString(16).padStart(64, "0");
  const key = generatePrivateKey();
  afterEach(() => {
    config.stake.receiptSignerKey = "";
  });

  it("signs the payer, the payment nonce, the request, the exact body bytes and the listed schema", async () => {
    config.stake.receiptSignerKey = key;
    const res = await call(makeApp(async () => ({ rate: 1.5 })), nonce(1));
    expect(res.status).toBe(200);
    const text = await res.text();
    const signed = decodeReceipt(res.headers.get(RECEIPT_HEADER))!;
    expect(await receiptSignerOf(signed)).toBe(privateKeyToAccount(key).address);
    expect(signed.receipt).toEqual({
      payTo: SELLER,
      payer: "0x" + "99".repeat(20),
      paymentNonce: nonce(1),
      requestHash: requestHash("GET", "/fx", ""),
      outputHash: outputHash(text),
      schemaHash: schemaHash({ properties: { rate: { type: "number" } }, required: ["rate"], type: "object" }),
      httpStatus: 200,
    });
  });

  it("sends no receipt without a signer key, or when nothing was settled", async () => {
    expect((await call(makeApp(async () => ({ rate: 1 })), nonce(2))).headers.get(RECEIPT_HEADER)).toBeNull();
    config.stake.receiptSignerKey = key;
    const failed = await call(
      makeApp(async () => {
        throw new ServiceError("upstream is down", 503);
      }),
      nonce(3),
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get(RECEIPT_HEADER)).toBeNull();
  });
});

describe("constants", () => {
  it("test fixtures use the Base Sepolia USDC the project is wired to", () => {
    expect(accept().asset).toBe(USDC_ADDRESS);
  });
});
