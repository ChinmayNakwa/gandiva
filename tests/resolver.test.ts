import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { addLedger, type LedgerStatus } from "../src/registry/store.js";

const chain = vi.hoisted(() => ({ now: 2_000_000_000, outcome: { state: "unused", expired: false } as any }));
vi.mock("../src/x402/chain.js", () => ({
  chainTime: async () => chain.now,
  lookupAuthorization: async () => chain.outcome,
}));

const { resolveUnconfirmed } = await import("../src/x402/resolver.js");

const TX = "0x" + "ef".repeat(32);
function insert(status: LedgerStatus, validBefore: number) {
  return addLedger({
    buyer: "0xbuyer", seller: "0xseller", serviceId: "svc", serviceName: "svc", endpoint: "http://x", listed: "1000", asked: "1000", paid: "0", status, latencyMs: 1,
    auth: { from: "0x" + "99".repeat(20), nonce: "0x" + "01".repeat(32), validBefore, signedAt: validBefore - 120 },
  }).id;
}
const row = (id: number) => db.prepare("SELECT status, paid, tx_hash, reason FROM ledger WHERE id = ?").get(id) as any;

beforeEach(() => {
  db.exec("DELETE FROM ledger");
  chain.now = 2_000_000_000;
});

describe("resolver: unconfirmed payments are settled from the chain", () => {
  it("authorisation used on-chain -> paid, with the tx hash and the real amount", async () => {
    const id = insert("unconfirmed", chain.now + 60);
    chain.outcome = { state: "used", txHash: TX, amount: 1000n, to: "0xseller" };
    const s = await resolveUnconfirmed();
    expect(row(id)).toMatchObject({ status: "paid", paid: "1000", tx_hash: TX });
    expect(s.paid).toBe(1);
  });

  it("unused and past validBefore -> failed, not charged", async () => {
    const id = insert("unconfirmed", chain.now - 10);
    chain.outcome = { state: "unused", expired: true };
    const s = await resolveUnconfirmed();
    expect(row(id)).toMatchObject({ status: "failed_not_charged", paid: "0", tx_hash: null });
    expect(s.notCharged).toBe(1);
  });

  it("unused but still valid -> stays unconfirmed (a seller could still settle it)", async () => {
    const id = insert("unconfirmed", chain.now + 60);
    chain.outcome = { state: "unused", expired: false };
    const s = await resolveUnconfirmed();
    expect(row(id).status).toBe("unconfirmed");
    expect(s.stillOpen).toBe(1);
  });

  it("a used nonce whose tx cannot be found stays unconfirmed rather than guessing", async () => {
    const id = insert("unconfirmed", chain.now + 60);
    chain.outcome = { state: "used_tx_unknown" };
    await resolveUnconfirmed();
    expect(row(id).status).toBe("unconfirmed");
  });

  it("an RPC failure leaves the row for the next pass", async () => {
    const id = insert("unconfirmed", chain.now + 60);
    chain.outcome = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await resolveUnconfirmed();
    expect(row(id).status).toBe("unconfirmed");
  });
});

describe("resolver: late settlement audit", () => {
  it("a 'not charged' row whose authorisation is later settled is corrected to paid", async () => {
    const id = insert("failed_not_charged", Math.floor(Date.now() / 1000) + 60);
    chain.outcome = { state: "used", txHash: TX, amount: 1000n, to: "0xseller" };
    await resolveUnconfirmed();
    expect(row(id)).toMatchObject({ status: "paid", paid: "1000", tx_hash: TX });
  });

  it("a 'not charged' row whose authorisation is unused is left alone", async () => {
    const id = insert("failed_not_charged", Math.floor(Date.now() / 1000) + 60);
    chain.outcome = { state: "unused", expired: false };
    await resolveUnconfirmed();
    expect(row(id).status).toBe("failed_not_charged");
  });

  it("old 'not charged' rows past their grace period are no longer checked", async () => {
    const id = insert("failed_not_charged", Math.floor(Date.now() / 1000) - 3600);
    chain.outcome = { state: "used", txHash: TX, amount: 1000n, to: "0xseller" };
    await resolveUnconfirmed();
    expect(row(id).status).toBe("failed_not_charged");
  });
});
