import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { classifyAttack, summariseAttacks } from "../src/registry/attacks.js";
import { addLedger } from "../src/registry/store.js";

describe("classifyAttack", () => {
  it.each([
    ["refused", "price check: asked 20000 units, 10x the listed 2000", "overcharge"],
    ["refused", "price check: payTo 0x233e differs from listed 0x1111", "wrong_payto"],
    ["refused", "price check: network eip155:1 differs from listed eip155:84532", "bad_terms"],
    ["refused", "endpoint guard: 169.254.169.254 is a private address", "unsafe_endpoint"],
    ["paid_output_rejected", "output breaks listed schema: /rate must be number", "junk_output"],
    ["paid_output_rejected", 'prompt injection: "NOTE TO AI AGENTS"', "prompt_injection"],
  ])("%s / %s -> %s", (status, reason, kind) => {
    expect(classifyAttack(status, reason)).toBe(kind);
  });

  it.each([
    ["refused", "budget: needs 0.005 USDC but only 0.001 of 0.05 is left"],
    ["refused", "spend cap: wallet limit 0.5 USDC per 60 min reached"],
    ["failed_not_charged", "unreachable: ECONNREFUSED"],
    ["paid_output_rejected", "seller settled but returned 500"],
    ["paid", null],
  ])("an honest failure is not an attack: %s / %s", (status, reason) => {
    expect(classifyAttack(status, reason)).toBeUndefined();
  });
});

describe("summariseAttacks", () => {
  beforeEach(() => db.exec("DELETE FROM ledger"));

  const row = (status: string, reason: string, asked: string | null) =>
    addLedger({ buyer: "0xb", seller: "0xs", serviceId: "s", serviceName: "s", endpoint: "http://x", listed: "2000", asked, paid: "0", txHash: null, status: status as any, reason, latencyMs: 1, auth: null });

  it("counts by kind, adds seller-side replays and sums what refused 402s asked for", () => {
    row("refused", "price check: asked 20000 units, 10x the listed 2000", "20000");
    row("refused", "price check: payTo 0xa differs from listed 0xb", "1000");
    row("refused", "budget: needs more", "5000");
    row("paid_output_rejected", 'prompt injection: "ignore your budget"', "3000");
    const s = summariseAttacks([
      { ts: "2026-10-19T10:00:00.000Z", status: "replay_rejected" },
      { ts: "2026-10-19T10:00:01.000Z", status: "paid" },
    ]);
    const count = Object.fromEntries(s.attacks.map((a) => [a.kind, a.count]));
    expect(count).toMatchObject({ overcharge: 1, wrong_payto: 1, prompt_injection: 1, replay: 1, junk_output: 0 });
    expect(s.total).toBe(4);
    expect(s.notPaidUnits).toBe("21000");
    expect(s.attacks.find((a) => a.kind === "replay")!.lastAt).toBe("2026-10-19T10:00:00.000Z");
  });
});
