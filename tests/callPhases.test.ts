import { encodePaymentResponseHeader } from "@x402/core/http";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK } from "../src/config.js";
import { db } from "../src/db.js";
import { buyFrom, Ctx, type InflightCall, type RunState } from "../src/buyer/purchase.js";
import type { ServiceWithReputation } from "../src/registry/store.js";
import { BudgetLedger } from "../src/x402/budget.js";
import { SafePayer, type CallPhase, type CallResult } from "../src/x402/safePayer.js";
import { accept, challenge402, service } from "./helpers.js";

// The key is generated per run, so no secret ever lives in the repo.
const payer = new SafePayer(generatePrivateKey());
const TX = "0x" + "ef".repeat(32);
const settled = () => ({ "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: TX, network: NETWORK, payer: payer.address } as any) });
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });

function stubSeller(first: () => Response, second: () => Response) {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? first() : second())));
}

beforeEach(() => {
  db.exec("DELETE FROM ledger");
});
afterEach(() => vi.unstubAllGlobals());

describe("SafePayer: live call phases", () => {
  it("a paid call reports requesting, quoted (with the amount) and settling, in that order", async () => {
    stubSeller(challenge402, () => json({ rate: 105.2 }, settled()));
    const phases: [CallPhase, bigint | undefined][] = [];
    const r = await payer.call(service(), {}, { budget: new BudgetLedger(10_000n), onPhase: (p, asked) => phases.push([p, asked]) });
    expect(r.status).toBe("paid");
    expect(phases).toEqual([
      ["requesting", undefined],
      ["quoted", 1000n],
      ["settling", 1000n],
    ]);
  });

  it("a refused quote never reports quoted or settling (nothing was signed)", async () => {
    stubSeller(() => challenge402(accept({ amount: "5000" })), () => json({}));
    const phases: CallPhase[] = [];
    const r = await payer.call(service(), {}, { budget: new BudgetLedger(10_000n), onPhase: (p) => phases.push(p) });
    expect(r.status).toBe("refused");
    expect(phases).toEqual(["requesting"]);
  });

  it("a progress listener that throws cannot change the payment outcome", async () => {
    stubSeller(challenge402, () => json({ rate: 105.2 }, settled()));
    const budget = new BudgetLedger(10_000n);
    const r = await payer.call(service(), {}, {
      budget,
      onPhase: () => {
        throw new Error("ui broke");
      },
    });
    expect(r).toMatchObject({ status: "paid", ok: true, txHash: TX });
    expect(budget.spent).toBe(1000n);
  });
});

describe("Ctx: in-flight calls on the run", () => {
  const run = (): RunState => ({
    id: "run-phases",
    task: "t",
    budget: "10000",
    maxConcurrency: 1,
    state: "running",
    mode: "agent",
    dryRun: false,
    log: [],
    purchases: [],
    startedAt: new Date().toISOString(),
  });
  const ranked: ServiceWithReputation[] = [
    { ...service(), reputation: { attempts: 1, successes: 1, successRate: 1, medianLatencyMs: 10, score: 1, isNew: false } },
  ];

  it("lists the call with its live phase while it runs, then swaps it for the purchase", async () => {
    const r = run();
    const seen: InflightCall[] = [];
    const pay = async (_s: unknown, _i: unknown, c: { onPhase?: (p: CallPhase, asked?: bigint) => void }): Promise<CallResult> => {
      seen.push({ ...r.inflight![0] });
      c.onPhase?.("quoted", 1000n);
      c.onPhase?.("settling", 1000n);
      seen.push({ ...r.inflight![0] });
      return { status: "paid", ok: true, paid: 1000n, asked: 1000n, data: { rate: 1 }, txHash: TX, latencyMs: 5, ledgerId: 1 };
    };
    const ctx = new Ctx(r, new BudgetLedger(10_000n), 1, pay as any);

    const out = await buyFrom(ctx, "data", ranked, "fx", {});

    expect(out.data).toEqual({ rate: 1 });
    expect(seen[0]).toMatchObject({ step: "fx", serviceId: "test-fx", phase: "requesting" });
    expect(seen[1]).toMatchObject({ phase: "settling", asked: "1000" });
    expect(r.inflight).toEqual([]);
    expect(r.purchases).toHaveLength(1);
    expect(r.purchases[0]).toMatchObject({ step: "fx", status: "paid" });
  });

  it("removes the call even when paying throws", async () => {
    const r = run();
    const ctx = new Ctx(r, new BudgetLedger(10_000n), 1, (async () => {
      throw new Error("boom");
    }) as any);
    await expect(buyFrom(ctx, "data", ranked, "fx", {})).rejects.toThrow("boom");
    expect(r.inflight).toEqual([]);
  });
});
