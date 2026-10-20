import { zeroAddress, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { checkClaim, checkRebuttal, rpcChainView } from "../src/stake/verify.js";
import { BUYER, evidence, fakeChain, GOOD, nonceOf, PAID_AT, receiptFor, SELLER } from "./stakeFixtures.js";

// What every verifier checks before it signs a SellerStakeV2 claim: payment on chain, the seller's own receipt, the schema.
const NOW = PAID_AT + 60n;

describe("checkClaim", () => {
  it("kind 1: the seller's own receipt covers junk output, so the claim message is ready to sign", async () => {
    const { hash, bundle, nonce } = await evidence({ n: 1 });
    expect(await checkClaim(hash, bundle, fakeChain(), NOW)).toEqual({
      ok: true,
      kind: 1,
      message: { seller: SELLER, buyer: BUYER, amount: 1000n, paymentNonce: nonce, evidence: hash, kind: 1, deadline: PAID_AT + 3600n },
    });
  });

  it("kind 1 also when the seller signed an error status; the amount is capped at 0.10 USDC", async () => {
    const body = '{"error":"upstream down"}';
    const { hash, bundle } = await evidence({ n: 2, body, status: 500, amount: 150_000n, receipt: await receiptFor(body, { nonce: nonceOf(2), httpStatus: 500 }) });
    const v = await checkClaim(hash, bundle, fakeChain(), NOW);
    expect(v).toMatchObject({ ok: true, kind: 1, message: { amount: 100_000n } });
  });

  it("kind 2 when no valid receipt came back: none, another key's, a deliberately-off one, or the body was lost", async () => {
    const off = await receiptFor(GOOD, { nonce: nonceOf(5) }); // signed over a different body than the one delivered
    for (const [n, o] of [
      [3, { receipt: null }],
      [4, { receipt: await receiptFor('{"rate":"high"}', { key: generatePrivateKey(), nonce: nonceOf(4) }) }],
      [5, { receipt: off }],
      [6, { body: null }],
    ] as const) {
      const { hash, bundle } = await evidence({ n, ...o });
      expect(await checkClaim(hash, bundle, fakeChain(), NOW), `case ${n}`).toMatchObject({ ok: true, kind: 2 });
    }
  });

  it("refuses output that fits the schema the seller signed", async () => {
    const { hash, bundle } = await evidence({ n: 7, body: GOOD });
    expect(await checkClaim(hash, bundle, fakeChain(), NOW)).toMatchObject({ ok: false, code: "rejected", reason: /fits the schema/ });
  });

  it("calls a seller with no receipt signer not slashable", async () => {
    const { hash, bundle } = await evidence({ n: 8 });
    expect(await checkClaim(hash, bundle, fakeChain({ signer: zeroAddress }), NOW)).toMatchObject({ ok: false, code: "not_slashable" });
  });

  it("refuses a tampered bundle, a payment the chain does not show, and a claim past its deadline", async () => {
    const a = await evidence({ n: 9 });
    expect(await checkClaim(a.hash, { ...a.bundle, reason: "edited" }, fakeChain(), NOW)).toMatchObject({ ok: false, reason: /does not match its hash/ });
    expect(await checkClaim(a.hash, a.bundle, fakeChain({ transferred: 1n }), NOW)).toMatchObject({ ok: false, code: "rejected", reason: /does not show this payment/ });
    expect(await checkClaim(a.hash, a.bundle, fakeChain(), PAID_AT + 3601n)).toMatchObject({ ok: false, reason: /deadline/ });
  });

  it("asks to retry while the settlement tx is not visible yet", async () => {
    const { hash, bundle } = await evidence({ n: 10, onChain: false });
    expect(await checkClaim(hash, bundle, fakeChain(), NOW)).toMatchObject({ ok: false, code: "retry" });
  });
});

describe("checkRebuttal", () => {
  it("accepts the seller's receipt over valid output, and nothing less", async () => {
    const { bundle } = await evidence({ n: 11, receipt: null });
    expect((await checkRebuttal(bundle, { receipt: await receiptFor(GOOD, { nonce: nonceOf(11) }), body: GOOD }, fakeChain())).ok).toBe(true);
    expect((await checkRebuttal(bundle, { receipt: await receiptFor('{"rate":"x"}', { nonce: nonceOf(11) }), body: '{"rate":"x"}' }, fakeChain())).ok).toBe(false);
    expect((await checkRebuttal(bundle, { receipt: await receiptFor(GOOD, { nonce: nonceOf(12) }), body: GOOD }, fakeChain())).ok).toBe(false);
    expect((await checkRebuttal(bundle, { receipt: await receiptFor(GOOD, { key: generatePrivateKey(), nonce: nonceOf(11) }), body: GOOD }, fakeChain())).ok).toBe(false);
  });
});

describe("rpcChainView.receiptSignerAt", () => {
  const OLD = "0x00000000000000000000000000000000000000aa" as Hex;
  const NEW = "0x00000000000000000000000000000000000000bb" as Hex;
  const pub = (changes: unknown[], seen: { fromBlock?: bigint }) =>
    ({
      getBlockNumber: async () => 500n,
      readContract: async () => NEW,
      getLogs: async (q: { fromBlock: bigint }) => ((seen.fromBlock = q.fromBlock), changes),
    }) as any;

  it("rebuilds the signer at a past block from the events since, without an archive node", async () => {
    const seen: { fromBlock?: bigint } = {};
    expect(await rpcChainView(pub([{ args: { previous: OLD } }], seen), SELLER).receiptSignerAt(SELLER, 100n)).toBe(OLD);
    expect(seen.fromBlock).toBe(101n);
    expect(await rpcChainView(pub([], {}), SELLER).receiptSignerAt(SELLER, 100n)).toBe(NEW);
  });
});
