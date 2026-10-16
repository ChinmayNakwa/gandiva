import { describe, expect, it } from "vitest";
import { checkAgainstListing } from "../src/x402/safePayer.js";
import { accept, OTHER, paymentRequired, service } from "./helpers.js";

const check = (a: Record<string, unknown>, svc = service()) => checkAgainstListing(svc, paymentRequired(a));

describe("price check (refuse a 402 that differs from the listing)", () => {
  it("accepts a 402 that matches the listing exactly", () => {
    expect(check(accept()).ok).toBe(true);
  });

  it("accepts a 402 that asks for less than listed", () => {
    expect(check(accept({ amount: "500" })).ok).toBe(true);
  });

  it("refuses a higher amount and says how much higher", () => {
    const r = check(accept({ amount: "10000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/10x the listed 1000/);
  });

  it("refuses one unit above the listed price", () => {
    expect(check(accept({ amount: "1001" })).ok).toBe(false);
  });

  it("refuses a different payTo but ignores address casing", () => {
    const r = check(accept({ payTo: OTHER }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/payTo/);
    expect(check(accept({ payTo: "0x" + "1".repeat(40).toUpperCase() })).ok).toBe(true);
  });

  it("refuses a different token", () => {
    const r = check(accept({ asset: OTHER }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/token/);
  });

  it("refuses a different network", () => {
    const r = check(accept({ network: "eip155:8453" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/network/);
  });

  it("refuses a scheme other than exact", () => {
    expect(check(accept({ scheme: "upto" })).ok).toBe(false);
  });

  it("refuses garbage and negative amounts", () => {
    expect(check(accept({ amount: "abc" })).ok).toBe(false);
    expect(check(accept({ amount: "-5" })).ok).toBe(false);
  });

  it("refuses unreasonable timeouts", () => {
    expect(check(accept({ maxTimeoutSeconds: 0 })).ok).toBe(false);
    expect(check(accept({ maxTimeoutSeconds: 86_400 })).ok).toBe(false);
  });

  it("refuses an unsupported protocol version and an empty accepts list", () => {
    expect(checkAgainstListing(service(), { ...paymentRequired(), x402Version: 1 } as any).ok).toBe(false);
    expect(checkAgainstListing(service(), { ...paymentRequired(), accepts: [] } as any).ok).toBe(false);
  });

  it("picks the matching option when a 402 offers several", () => {
    const pr = { ...paymentRequired(), accepts: [accept({ amount: "99999" }), accept()] } as any;
    const r = checkAgainstListing(service(), pr);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.accept.amount).toBe("1000");
  });
});
