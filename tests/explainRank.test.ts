import { describe, expect, it } from "vitest";
import { explainRank, rankCompare, setCredibilityLookup, type ServiceWithReputation } from "../src/registry/store.js";

const svc = (id: string, o: { score?: number; price?: string; latency?: number | null; verification?: ServiceWithReputation["verification"] } = {}): ServiceWithReputation =>
  ({
    id,
    name: id,
    category: "data",
    endpoint: `https://example.com/${id}`,
    method: "GET",
    price: o.price ?? "1000",
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x0000000000000000000000000000000000000001",
    inputSchema: {},
    outputSchema: {},
    description: "",
    owner: "external",
    verification: o.verification ?? "verified",
    verificationNote: "",
    verifiedAt: null,
    reputation: { attempts: 5, successes: 5, successRate: 1, medianLatencyMs: o.latency === undefined ? 100 : o.latency, score: o.score ?? 1, isNew: false },
  }) as ServiceWithReputation;

describe("explainRank", () => {
  const cred: Record<string, number> = { high: 80, low: 20 };
  setCredibilityLookup((id) => cred[id]);

  const cases: [string, ServiceWithReputation, ServiceWithReputation, string][] = [
    ["verification", svc("a"), svc("b", { verification: "mismatch", score: 1, price: "1" }), "verification"],
    ["reputation", svc("a", { score: 0.9 }), svc("b", { score: 0.5, price: "1" }), "reputation"],
    ["price", svc("a", { price: "1000" }), svc("b", { price: "2000" }), "price"],
    ["credibility", svc("high"), svc("low", { latency: 1 }), "credibility"],
    ["latency", svc("a", { latency: 50 }), svc("b", { latency: 900 }), "latency"],
    ["tie", svc("a"), svc("b"), "tie"],
  ];

  for (const [name, a, b, rule] of cases) {
    it(`names the ${name} rule, in the same order rankCompare decides`, () => {
      expect(rankCompare(a, b)).toBeLessThanOrEqual(0);
      expect(explainRank(a, b).rule).toBe(rule);
    });
  }

  it("ranks a same-price, same-reputation seller with more credibility first", () => {
    expect([svc("low", { latency: 1 }), svc("high", { latency: 999 })].sort(rankCompare).map((s) => s.id)).toEqual(["high", "low"]);
  });
});
