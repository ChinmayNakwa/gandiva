import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/x402/budget.js";

describe("budget under concurrency", () => {
  it("never lets 50 parallel reservations exceed the budget", async () => {
    const budget = new BudgetLedger(12_000n); // 0.012 USDC
    const results = await Promise.all(Array.from({ length: 50 }, () => budget.reserve(1_000n)));
    const granted = results.filter(Boolean);
    expect(granted).toHaveLength(12);
    expect(budget.reserved).toBe(12_000n);
    granted.forEach((r) => r!.commit());
    expect(budget.spent).toBe(12_000n);
    expect(budget.reserved).toBe(0n);
    expect(budget.remaining).toBe(0n);
    expect(await budget.reserve(1n)).toBeNull();
  });

  it("frees released money for other calls but keeps committed money spent", async () => {
    const budget = new BudgetLedger(2_000n);
    const a = (await budget.reserve(1_000n))!;
    const b = (await budget.reserve(1_000n))!;
    expect(await budget.reserve(1_000n)).toBeNull();
    a.release();
    const c = await budget.reserve(1_000n);
    expect(c).not.toBeNull();
    b.commit();
    c!.commit();
    expect(budget.spent).toBe(2_000n);
    expect(await budget.reserve(1n)).toBeNull();
  });

  it("commit and release are idempotent", async () => {
    const budget = new BudgetLedger(1_000n);
    const r = (await budget.reserve(1_000n))!;
    r.commit();
    r.commit();
    r.release();
    expect(budget.spent).toBe(1_000n);
    expect(budget.reserved).toBe(0n);
  });

  it("rejects zero and negative amounts", async () => {
    const budget = new BudgetLedger(1_000n);
    expect(await budget.reserve(0n)).toBeNull();
    expect(await budget.reserve(-1n)).toBeNull();
  });

  it("mixed amounts in parallel still stay within budget", async () => {
    const budget = new BudgetLedger(10_000n);
    const amounts = Array.from({ length: 40 }, (_, i) => BigInt(1_000 + (i % 5) * 700));
    const rs = (await Promise.all(amounts.map((a) => budget.reserve(a)))).filter(Boolean);
    const total = rs.reduce((s, r) => s + r!.amount, 0n);
    expect(total).toBeLessThanOrEqual(10_000n);
    expect(budget.spent + budget.reserved).toBe(total);
  });
});
