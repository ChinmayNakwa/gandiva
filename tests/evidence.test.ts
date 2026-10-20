import { encodePaymentResponseHeader } from "@x402/core/http";
import { keccak256, toBytes } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/stake/claims.js", () => ({ fileClaim: vi.fn() }));

import { canonical } from "../src/buyer/catalogue.js";
import { NETWORK } from "../src/config.js";
import { evidenceForLedger, MAX_EVIDENCE_BODY } from "../src/stake/evidence.js";
import { fileClaim } from "../src/stake/claims.js";
import { outputHash, RECEIPT_HEADER, requestHash, schemaHash, signReceipt } from "../src/stake/receipt.js";
import { BudgetLedger } from "../src/x402/budget.js";
import { SafePayer } from "../src/x402/safePayer.js";
import { challenge402, SELLER, service } from "./helpers.js";

// SafePayer keeps what a stake claim needs when a seller is paid and its answer is rejected: the raw body, the seller's
// receipt and the request, in a bundle whose id anyone can recompute.
const TX = "0x" + "ab".repeat(32);
const payer = new SafePayer(generatePrivateKey());

/** The seller answers the first request with a 402 and the paid one with this body, status and headers. */
function seller(body: string, status = 200, headers: Record<string, string> = {}) {
  let n = 0;
  const settled = encodePaymentResponseHeader({ success: true, transaction: TX, network: NETWORK, payer: payer.address } as any);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (n++ === 0 ? challenge402() : new Response(body, { status, headers: { "Content-Type": "application/json", "PAYMENT-RESPONSE": settled, ...headers } }))),
  );
}
const run = () => payer.call(service(), { from: "USD" }, { budget: new BudgetLedger(10_000n) });

describe("evidence for paid-and-rejected calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("junk output: keeps the raw body, the receipt and the request, under an id that re-hashes from the bundle", async () => {
    const junk = '{"rate":"high"}';
    const receipt = await signReceipt(generatePrivateKey(), {
      payTo: SELLER,
      payer: payer.address,
      paymentNonce: `0x${"cd".repeat(32)}`,
      requestHash: requestHash("GET", "/fx?from=USD", ""),
      outputHash: outputHash(junk),
      schemaHash: schemaHash(service().outputSchema),
      httpStatus: 200,
    });
    seller(junk, 200, { [RECEIPT_HEADER]: receipt });
    const r = await run();
    expect(r.status).toBe("paid_output_rejected");
    const ev = evidenceForLedger(r.ledgerId)!;
    expect(ev.hash).toBe(keccak256(toBytes(canonical(ev.bundle))));
    expect(ev.bundle).toMatchObject({
      v: 1,
      chainId: 84532,
      serviceId: "test-fx",
      payment: { payTo: SELLER, payer: payer.address, amount: "1000", txHash: TX },
      request: { method: "GET", path: "/fx?from=USD", body: "" },
      outputSchema: service().outputSchema,
      response: { status: 200, body: junk, bodyHash: outputHash(junk), receipt },
    });
    expect(ev.bundle.payment.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fileClaim).toHaveBeenCalledWith({ ledgerId: r.ledgerId, evidence: ev.hash, seller: SELLER, buyer: payer.address });
  });

  it("an error status after settling is kept too, without a receipt", async () => {
    seller('{"error":"boom"}', 500);
    const r = await run();
    expect(r.reason).toMatch(/^seller settled but returned 500/);
    expect(evidenceForLedger(r.ledgerId)!.bundle.response).toEqual({ status: 500, body: '{"error":"boom"}', bodyHash: outputHash('{"error":"boom"}'), receipt: null });
  });

  it("a body over 1 MB keeps only its hash", async () => {
    const big = JSON.stringify({ rate: "x".repeat(MAX_EVIDENCE_BODY) });
    seller(big);
    const r = await run();
    expect(r.status).toBe("paid_output_rejected");
    expect(evidenceForLedger(r.ledgerId)!.bundle.response).toMatchObject({ body: null, bodyHash: outputHash(big) });
  });

  it("good output stores nothing", async () => {
    seller('{"rate":1.2}');
    const ok = await run();
    expect(ok.status).toBe("paid");
    expect(evidenceForLedger(ok.ledgerId)).toBeUndefined();
    expect(fileClaim).not.toHaveBeenCalledWith(expect.objectContaining({ ledgerId: ok.ledgerId }));
  });
});
