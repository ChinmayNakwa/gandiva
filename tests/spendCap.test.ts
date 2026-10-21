import { encodePaymentResponseHeader } from "@x402/core/http";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK } from "../src/config.js";
import { db } from "../src/db.js";
import { addLedger, type LedgerStatus } from "../src/registry/store.js";
import { BudgetLedger } from "../src/x402/budget.js";
import { SafePayer } from "../src/x402/safePayer.js";
import { SpendCap } from "../src/x402/spendCap.js";
import { challenge402, service } from "./helpers.js";

const HOUR = 60 * 60_000;
function ledger(status: LedgerStatus, paid: string, asked = paid, ageMs = 0) {
  addLedger({ buyer: "0xb", seller: "0xs", serviceName: "svc", endpoint: "http://x", listed: "1000", asked, paid, status, latencyMs: 1 });
  if (ageMs) db.prepare("UPDATE ledger SET ts = ? WHERE id = (SELECT MAX(id) FROM ledger)").run(new Date(Date.now() - ageMs).toISOString());
}

beforeEach(() => db.exec("DELETE FROM ledger"));
afterEach(() => vi.unstubAllGlobals());

describe("wallet-level spend cap", () => {
  it("counts charged and unconfirmed rows in the window, but not refusals, failures or old spending", async () => {
    const cap = new SpendCap(10_000n, HOUR);
    ledger("paid", "1000");
    ledger("paid_output_rejected", "2000");
    ledger("unconfirmed", "0", "3000");
    ledger("refused", "0", "9999");
    ledger("failed_not_charged", "0", "9999");
    ledger("paid", "5000", "5000", 2 * HOUR);
    expect(cap.used()).toBe(6000n);
    expect(cap.status().remaining).toBe("4000");
  });

  it("a seller that errors after signing cannot cash the signatures past the cap", async () => {
    const fetchMock = vi.fn(async (_u: unknown, init: any) => (init?.headers?.["PAYMENT-SIGNATURE"] ? new Response(JSON.stringify({ error: "boom" }), { status: 500 }) : challenge402()));
    vi.stubGlobal("fetch", fetchMock);
    const payer = new SafePayer(generatePrivateKey(), new SpendCap(5_000n, HOUR));
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await payer.call(service(), {}, { budget: new BudgetLedger(100_000n) }));
    // 0.005 cap at 0.001 per call: 5 live signatures, then nothing more is signed
    expect(results.filter((r) => r.status === "failed_not_charged")).toHaveLength(5);
    expect(results.filter((r) => r.reason?.startsWith("spend cap:"))).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(5 * 2 + 3);
  });

  it("an expired failed signature no longer counts", () => {
    const cap = new SpendCap(10_000n, HOUR);
    const auth = (validBefore: number) => ({ from: "0xb", nonce: "0x" + "01".repeat(32), validBefore, signedAt: validBefore - 60 });
    const now = Math.floor(Date.now() / 1000);
    addLedger({ buyer: "0xb", seller: "0xs", serviceName: "svc", endpoint: "http://x", listed: "1000", asked: "3000", paid: "0", status: "failed_not_charged", latencyMs: 1, auth: auth(now + 60) });
    addLedger({ buyer: "0xb", seller: "0xs", serviceName: "svc", endpoint: "http://x", listed: "1000", asked: "4000", paid: "0", status: "failed_not_charged", latencyMs: 1, auth: auth(now - 1) });
    expect(cap.used()).toBe(3000n);
  });

  it("50 parallel reservations cannot push past the limit", async () => {
    const cap = new SpendCap(10_000n, HOUR);
    const holds = (await Promise.all(Array.from({ length: 50 }, () => cap.reserve(1_000n)))).filter(Boolean);
    expect(holds).toHaveLength(10);
    expect(await cap.reserve(1n)).toBeNull();
    holds[0]!.release();
    expect(await cap.reserve(1_000n)).not.toBeNull();
  });

  it("limit 0 disables the cap", async () => {
    const cap = new SpendCap(0n, HOUR);
    expect(cap.enabled).toBe(false);
    expect(await cap.reserve(10n ** 12n)).not.toBeNull();
  });

  it("SafePayer refuses with 'spend cap:' and never signs once the wallet limit is reached", async () => {
    ledger("paid", "500000"); // the default 0.5 USDC limit is already used
    const fetchMock = vi.fn(async () => challenge402());
    vi.stubGlobal("fetch", fetchMock);
    const payer = new SafePayer(generatePrivateKey());
    const budget = new BudgetLedger(100_000n);
    const r = await payer.call(service(), {}, { budget });
    expect(r.status).toBe("refused");
    expect(r.reason).toMatch(/^spend cap:/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(100_000n);
  });

  it("a payment under the cap goes through and then counts against it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init: any) =>
        init?.headers?.["PAYMENT-SIGNATURE"]
          ? new Response(JSON.stringify({ rate: 1 }), { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "0x" + "aa".repeat(32), network: NETWORK, payer: "0x" + "99".repeat(20) } as any) } })
          : challenge402(),
      ),
    );
    const payer = new SafePayer(generatePrivateKey());
    const r = await payer.call(service(), {}, { budget: new BudgetLedger(100_000n) });
    expect(r.status).toBe("paid");
    const { spendCap } = await import("../src/x402/spendCap.js");
    expect(spendCap.used()).toBe(1000n);
  });
});
