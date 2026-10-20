import { getAddress, keccak256, recoverTypedDataAddress, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";
import { canonical } from "../buyer/catalogue.js";

/**
 * Seller-signed receipt for a paid call: which payment it answers, and hashes of the request, the exact response bytes
 * and the output schema they promised. It is the evidence a SellerStakeV2 claim is checked against; standard x402
 * clients ignore the header.
 */
export const RECEIPT_HEADER = "X-Gandiva-Receipt";

const domain = { name: "Gandiva Receipt", version: "1", chainId: baseSepolia.id } as const;
const types = {
  Receipt: [
    { name: "payTo", type: "address" },
    { name: "payer", type: "address" },
    { name: "paymentNonce", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "schemaHash", type: "bytes32" },
    { name: "httpStatus", type: "uint16" },
  ],
} as const;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Signed = z.object({
  receipt: z.object({ payTo: address, payer: address, paymentNonce: hex32, requestHash: hex32, outputHash: hex32, schemaHash: hex32, httpStatus: z.number().int().min(0).max(65535) }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

export interface Receipt {
  payTo: Hex;
  payer: Hex;
  paymentNonce: Hex;
  requestHash: Hex;
  outputHash: Hex;
  schemaHash: Hex;
  httpStatus: number;
}
export type SignedReceipt = { receipt: Receipt; signature: Hex };

/** The host is left out: a buyer may reach the seller under another name (localhost vs the public URL). */
export const requestHash = (method: string, pathAndQuery: string, body: string) => keccak256(toBytes(`${method.toUpperCase()} ${pathAndQuery}\n${body}`));
export const outputHash = (rawBody: string) => keccak256(toBytes(rawBody));
export const schemaHash = (schema: unknown) => keccak256(toBytes(canonical(schema)));

/** Returns the header value: base64 JSON of { receipt, signature }. */
export async function signReceipt(key: Hex, r: Receipt): Promise<string> {
  const receipt = { ...r, payTo: getAddress(r.payTo), payer: getAddress(r.payer) };
  const signature = await privateKeyToAccount(key).signTypedData({ domain, types, primaryType: "Receipt", message: receipt });
  return Buffer.from(JSON.stringify({ receipt, signature })).toString("base64");
}

/** undefined for a missing or malformed header: the seller controls it. */
export function decodeReceipt(header: string | null | undefined): SignedReceipt | undefined {
  if (!header) return undefined;
  try {
    const parsed = Signed.safeParse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
    return parsed.success ? (parsed.data as SignedReceipt) : undefined;
  } catch {
    return undefined;
  }
}

export const receiptSignerOf = (s: SignedReceipt) => recoverTypedDataAddress({ domain, types, primaryType: "Receipt", message: s.receipt, signature: s.signature });
