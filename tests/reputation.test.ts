import { describe, expect, it } from "vitest";
import { computeReputation } from "../src/registry/store.js";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-17T12:00:00Z");
const row = (status: "paid" | "paid_output_rejected" | "refused", hoursAgo = 0, latency_ms = 100) => ({
  status,
  latency_ms,
  ts: new Date(NOW - hoursAgo * HOUR).toISOString(),
});
const rep = (rows: ReturnType<typeof row>[], half = 6 * HOUR) => computeReputation(rows, NOW, half, 3);

describe("reputation: time-weighted score", () => {
  it("an untried seller scores 1.0 and is labelled new", () => {
    expect(rep([])).toMatchObject({ attempts: 0, score: 1, isNew: true });
  });

  it("fresh calls count fully, like the old formula", () => {
    expect(rep([row("paid"), row("paid")]).score).toBeCloseTo(1, 5);
    expect(rep([row("paid_output_rejected")]).score).toBeCloseTo(0.5, 5);
    expect(rep([row("paid"), row("paid_output_rejected")]).score).toBeCloseTo(2 / 3, 5);
  });

  it("a fresh failure hurts more than an old one", () => {
    const fresh = rep([row("paid_output_rejected", 0)]).score;
    const old = rep([row("paid_output_rejected", 12)]).score;
    expect(fresh).toBeLessThan(old);
    expect(old).toBeCloseTo(1 / 1.25, 5); // weight 0.25 after two half-lives
  });

  it("a seller recovers over time but not instantly", () => {
    const justNow = rep([row("paid_output_rejected", 0)]).score;
    const sixHours = rep([row("paid_output_rejected", 6)]).score;
    const twoDays = rep([row("paid_output_rejected", 48)]).score;
    expect(justNow).toBeCloseTo(0.5, 5);
    expect(sixHours).toBeGreaterThan(justNow);
    expect(sixHours).toBeLessThan(0.7);
    expect(twoDays).toBeGreaterThan(0.99);
  });

  it("recent successes outweigh old failures", () => {
    const rows = [row("paid_output_rejected", 24), row("paid", 0), row("paid", 0)];
    expect(rep(rows).score).toBeGreaterThan(0.95);
  });

  it("keeps plain counts for display and median latency from successes only", () => {
    const r = rep([row("paid", 30, 100), row("paid", 20, 300), row("refused", 0, 5000)]);
    expect(r).toMatchObject({ attempts: 3, successes: 2, medianLatencyMs: 200 });
    expect(r.successRate).toBeCloseTo(2 / 3, 5);
  });

  it("is labelled new until it has 3 attempts", () => {
    expect(rep([row("paid"), row("paid")]).isNew).toBe(true);
    expect(rep([row("paid"), row("paid"), row("paid")]).isNew).toBe(false);
  });

  it("a half-life of 0 turns time weighting off", () => {
    expect(rep([row("paid_output_rejected", 500)], 0).score).toBeCloseTo(0.5, 5);
  });
});
