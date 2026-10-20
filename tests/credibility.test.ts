import { describe, expect, it } from "vitest";
import { stakeCheck } from "../src/registry/credibility.js";

// The stake part of a seller's credibility: only a bond verifiers can slash earns full credit.
const pos = (staked: number, o: { slashable?: boolean; unlockAt?: number } = {}) => ({ staked: String(staked), unlockAt: o.unlockAt ?? 0, slashable: o.slashable ?? true });
const none = { count: 0, amount: 0n };

describe("stakeCheck", () => {
  it("gives a slashable bond up to 20, full from 0.05 USDC", () => {
    expect(stakeCheck(pos(50_000), none)).toMatchObject({ points: 20, max: 20, status: "pass" });
    expect(stakeCheck(pos(200_000), none).points).toBe(20);
    expect(stakeCheck(pos(25_000), none)).toMatchObject({ points: 10, status: "partial" });
    expect(stakeCheck(pos(25_000), none).detail).toMatch(/slashable by 2 of 3/);
  });

  it("caps a bond with no receipt signer at 10", () => {
    expect(stakeCheck(pos(200_000, { slashable: false }), none)).toMatchObject({ points: 10, status: "partial" });
    expect(stakeCheck(pos(10_000, { slashable: false }), none).points).toBe(4);
    expect(stakeCheck(pos(200_000, { slashable: false }), none).detail).toMatch(/cannot be slashed/);
  });

  it("gives 0 while unstaking and when nothing is staked", () => {
    expect(stakeCheck(pos(200_000, { unlockAt: 1_800_000_000 }), none)).toMatchObject({ points: 0, status: "fail" });
    expect(stakeCheck(pos(0), none)).toMatchObject({ points: 0, status: "fail", detail: "nothing staked" });
  });

  it("takes 5 per executed slash, never below 0", () => {
    const once = stakeCheck(pos(50_000), { count: 1, amount: 40_000n });
    expect(once.points).toBe(15);
    expect(once.detail).toMatch(/slashed 1x for junk \(0\.040000 USDC/);
    expect(stakeCheck(pos(50_000, { slashable: false }), { count: 3, amount: 0n }).points).toBe(0);
  });
});
