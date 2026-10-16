import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { BRIEF_ID, BRIEF_SUB_BUDGET, briefOutput, briefUnavailable, suppliers, travelBrief, type BriefDeps } from "../src/sellers/brief.js";
import { sellerDefs } from "../src/sellers/index.js";
import { ServiceError } from "../src/x402/paidRoute.js";
import { validate } from "../src/x402/schema.js";
import type { BudgetLedger } from "../src/x402/budget.js";
import type { CallResult } from "../src/x402/safePayer.js";
import { service } from "./helpers.js";

const rep = (score: number) => ({ attempts: 5, successes: 5, successRate: 1, medianLatencyMs: 50, score, isNew: false });
const listed = (verification: "verified" | "mismatch" | "unchecked" = "verified") =>
  sellerDefs().map((d) => ({
    ...service({ id: d.id, name: d.name, category: d.category, price: d.listedPrice.toString(), inputSchema: d.inputSchema, outputSchema: d.outputSchema, description: d.description, verification }),
    reputation: rep(1),
  }));

/** Pays like the marketplace would: reserves from the brief's sub-budget, then returns what each seller would return. */
function fakePay() {
  const calls: { id: string; input: any }[] = [];
  const spent = { units: 0n };
  const pay = async (s: any, input: any, ctx: { budget: BudgetLedger }): Promise<CallResult> => {
    calls.push({ id: s.id, input });
    const base = { latencyMs: 5, ledgerId: calls.length };
    const price = BigInt(s.price);
    const hold = await ctx.budget.reserve(price);
    if (!hold) return { ...base, status: "refused", ok: false, paid: 0n, asked: price, reason: `budget: needs ${price} but only ${ctx.budget.remaining} is left` };
    hold.commit();
    spent.units += price;
    const paid = { ...base, paid: price, asked: price, txHash: `0x${s.id}` };
    switch (s.id) {
      case "city-info":
        return { ...paid, status: "paid", ok: true, data: { city: input.name, country: "Japan", country_code: "JP", currency: "JPY", timezone: "Asia/Tokyo", temperature_c: 21, wind_kmh: 9, conditions: "clear sky", observed_at: "now" } };
      case "fx-rates":
        return { ...paid, status: "paid", ok: true, data: { from: input.from, to: input.to, rate: 190, date: "2026-01-01" } };
      case "junk-fx":
        return { ...paid, status: "paid_output_rejected", ok: false, reason: "output breaks listed schema" };
      case "hindi-summary":
        return { ...paid, status: "paid", ok: true, data: { language: "hi", summaries: input.texts.map((t: string) => ({ summary: `हिंदी ${t}` })) } };
    }
    throw new Error(`the brief hired ${s.id}, which it must not`);
  };
  return { pay, calls, spent };
}

const deps = (over: Partial<BriefDeps> = {}) => {
  const p = fakePay();
  return { p, d: { pay: p.pay, address: "0xbrief", balance: async () => 1_000_000n, services: () => listed(), ...over } as BriefDeps };
};

describe("travel-brief (an agent that hires and pays other sellers)", () => {
  it("hires weather, FX and Hindi in order, with each one's payment in the answer", async () => {
    const { p, d } = deps();
    const out = await travelBrief({ city: "Tokyo", amount: 100, from: "gbp", hindi: true }, d);
    expect(p.calls.map((c) => c.id)).toEqual(["city-info", "fx-rates", "hindi-summary"]);
    expect(p.calls[1].input).toEqual({ from: "GBP", to: "JPY" });
    expect(p.calls[2].input.texts[0]).toContain("19000 JPY");
    expect(out.conversion).toMatchObject({ from: "GBP", to: "JPY", rate: 190, converted: 19000 });
    expect(out.hired.map((h) => h.service)).toEqual(["city-info", "fx-rates", "hindi-summary"]);
    expect(out.hired.every((h) => h.tx_hash)).toBe(true);
    expect(out.cost_units).toBe("13000");
    expect(out.brief_hi).toMatch(/[ऀ-ॿ]/);
    expect(validate(briefOutput, out)).toEqual({ ok: true });
  });

  it("does not hire a Hindi seller unless asked, and skips FX when no conversion is needed", async () => {
    const { p, d } = deps();
    const out = await travelBrief({ city: "Tokyo", amount: 5, from: "JPY" }, d);
    expect(p.calls.map((c) => c.id)).toEqual(["city-info"]);
    expect(out.conversion.rate).toBe(1);
    expect(out.brief_hi).toBeUndefined();
    expect(out.cost_units).toBe("2000");
    expect(validate(briefOutput, out)).toEqual({ ok: true });
  });

  it("never spends more than its sub-budget, and fails (so the buyer is not charged) when the job does not fit", async () => {
    const { p, d } = deps({ subBudget: 2500n });
    await expect(travelBrief({ city: "Tokyo", amount: 1, from: "GBP" }, d)).rejects.toThrow(/could not get exchange rate.*budget/);
    // weather (2000) was paid; FX (1000) did not fit into 2500, so it stayed unpaid
    expect(p.spent.units).toBe(2000n);
  });

  it("refuses up front when its wallet cannot cover a brief, before paying anyone", async () => {
    const { p, d } = deps({ balance: async () => BRIEF_SUB_BUDGET - 1n });
    const err = await travelBrief({ city: "Tokyo", amount: 1, from: "GBP" }, d).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/out of float/);
    expect(p.calls).toHaveLength(0);
  });

  it("refuses when the balance cannot be read", async () => {
    const { p, d } = deps({
      balance: async () => {
        throw new Error("rpc down");
      },
    });
    await expect(travelBrief({ city: "Tokyo", amount: 1, from: "GBP" }, d)).rejects.toThrow(/cannot check the travel-brief wallet balance/);
    expect(p.calls).toHaveLength(0);
  });

  it("moves on to the next FX seller when the first returns junk, and shows the junk payment too", async () => {
    const all = listed();
    const reordered = [...all.filter((s) => s.id === "junk-fx"), ...all.filter((s) => s.id !== "junk-fx")];
    const { p, d } = deps({ services: () => reordered });
    const out = await travelBrief({ city: "Tokyo", amount: 100, from: "GBP" }, d);
    expect(p.calls.map((c) => c.id)).toEqual(["city-info", "junk-fx", "fx-rates"]);
    expect(out.hired.map((h) => `${h.service}:${h.status}`)).toEqual(["city-info:paid", "junk-fx:paid_output_rejected", "fx-rates:paid"]);
    expect(out.cost_units).toBe("3800");
  });

  it("fails cleanly when nobody verified sells a Hindi summary", async () => {
    const { p, d } = deps({ services: () => listed().filter((s) => s.id !== "hindi-summary") });
    await expect(travelBrief({ city: "Tokyo", amount: 1, from: "GBP", hindi: true }, d)).rejects.toThrow(/no verified hindi seller/);
    expect(p.calls.map((c) => c.id)).toEqual(["city-info", "fx-rates"]);
  });

  it("never hires itself, a mismatching listing or an unchecked one", () => {
    const all = listed();
    expect(suppliers(all, "weather").map((s) => s.id)).toEqual(["city-info"]);
    expect(suppliers(all, "hindi").map((s) => s.id)).not.toContain(BRIEF_ID);
    expect(suppliers(listed("mismatch"), "fx")).toEqual([]);
    expect(suppliers(listed("unchecked"), "fx")).toEqual([]);
  });

  it("reports why it cannot run when its wallet is not configured", () => {
    const key = config.travelBriefKey;
    config.travelBriefKey = "";
    try {
      expect(briefUnavailable()).toMatch(/TRAVEL_BRIEF_KEY is not set/);
    } finally {
      config.travelBriefKey = key;
    }
  });
});
