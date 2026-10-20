import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { decodeReceipt, outputHash, receiptSignerOf, requestHash, schemaHash, signReceipt, type Receipt } from "../src/stake/receipt.js";

const key = generatePrivateKey();
const receipt = (): Receipt => ({
  payTo: "0x1111111111111111111111111111111111111111",
  payer: "0x9999999999999999999999999999999999999999",
  paymentNonce: `0x${"ab".repeat(32)}`,
  requestHash: requestHash("GET", "/fx?from=USD", ""),
  outputHash: outputHash('{"rate":1}'),
  schemaHash: schemaHash({ type: "object" }),
  httpStatus: 200,
});

describe("seller receipts", () => {
  it("round-trip through the header and recover to the signing key", async () => {
    const signed = decodeReceipt(await signReceipt(key, receipt()))!;
    expect(signed.receipt).toEqual(receipt());
    expect(await receiptSignerOf(signed)).toBe(privateKeyToAccount(key).address);
  });

  it("no longer recover to the signer once a field is changed", async () => {
    const signed = decodeReceipt(await signReceipt(key, receipt()))!;
    signed.receipt.outputHash = outputHash('{"rate":2}');
    expect(await receiptSignerOf(signed)).not.toBe(privateKeyToAccount(key).address);
  });

  it("hash schemas regardless of key order, and bodies byte for byte", () => {
    expect(schemaHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(schemaHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(outputHash('{"rate":1}')).not.toBe(outputHash('{"rate":1} '));
    expect(requestHash("get", "/fx", "")).toBe(requestHash("GET", "/fx", ""));
    expect(requestHash("POST", "/fx", '{"a":1}')).not.toBe(requestHash("POST", "/fx", '{"a":2}'));
  });

  it("ignore a missing or malformed header", async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
    const good = JSON.parse(Buffer.from(await signReceipt(key, receipt()), "base64").toString());
    for (const h of [undefined, null, "", "not base64 json", b64({ receipt: {} }), b64({ ...good, signature: "0x1234" }), b64({ ...good, receipt: { ...good.receipt, httpStatus: 70000 } })]) {
      expect(decodeReceipt(h)).toBeUndefined();
    }
  });
});
