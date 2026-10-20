import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDC_ADDRESS } from "../src/config.js";
import { getEvidence, saveEvidence } from "../src/stake/evidence.js";
import { outputHash, requestHash, schemaHash, signReceipt } from "../src/stake/receipt.js";
import type { ChainView } from "../src/stake/verify.js";

// A seller, a buyer and their payments as the chain would show them, for the stake claim tests.
export const SELLER = privateKeyToAccount(keccak256(toHex("seller"))).address;
export const BUYER = privateKeyToAccount(keccak256(toHex("buyer"))).address;
export const SIGNER_KEY = keccak256(toHex("receipt-signer"));
export const SIGNER = privateKeyToAccount(SIGNER_KEY).address;
export const SCHEMA = { type: "object", required: ["rate"], properties: { rate: { type: "number" } } };
export const JUNK = '{"rate":"high"}';
export const GOOD = '{"rate":1.2}';
export const PAID_AT = 1_800_000_000n; // block time of every payment
export const nonceOf = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const usdcEvents = parseAbi(["event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
const payments = new Map<Hex, { nonce: Hex; amount: bigint }>();

export const receiptFor = (body: string, o: { key?: Hex; nonce?: Hex; httpStatus?: number } = {}) =>
  signReceipt(o.key ?? SIGNER_KEY, {
    payTo: SELLER,
    payer: BUYER,
    paymentNonce: o.nonce ?? nonceOf(1),
    requestHash: requestHash("GET", "/fx", ""),
    outputHash: outputHash(body),
    schemaHash: schemaHash(SCHEMA),
    httpStatus: o.httpStatus ?? 200,
  });

let ledgerId = 10_000;
/** Stores evidence for payment `n` (and, unless told otherwise, puts that payment "on chain"). Default: junk with a valid receipt. */
export async function evidence(o: { n?: number; body?: string | null; receipt?: string | null; status?: number; amount?: bigint; onChain?: boolean } = {}) {
  const nonce = nonceOf(o.n ?? 1);
  const txHash = keccak256(nonce);
  const amount = o.amount ?? 1000n;
  if (o.onChain !== false) payments.set(txHash, { nonce, amount });
  const body = o.body === undefined ? JUNK : o.body;
  const receipt = o.receipt !== undefined ? o.receipt : body === null ? null : await receiptFor(body, { nonce });
  const hash = saveEvidence({
    chainId: 84532,
    ledgerId: ++ledgerId,
    serviceId: "fx",
    reason: "output breaks listed schema",
    payment: { payTo: SELLER, payer: BUYER, amount: amount.toString(), nonce, txHash },
    request: { method: "GET", path: "/fx", body: "" },
    outputSchema: SCHEMA,
    response: { status: o.status ?? 200, body, receipt },
  });
  return { hash, bundle: getEvidence(hash)!.bundle, ledgerId, nonce };
}

/** The chain as a verifier sees it. `transferred` overrides the USDC amount the logs show; `signer` the registered receipt signer. */
export function fakeChain(o: { signer?: Hex; transferred?: bigint } = {}): ChainView {
  return {
    async tx(hash) {
      const p = payments.get(hash);
      if (!p) return null;
      return {
        blockNumber: 100n,
        timestamp: PAID_AT,
        logs: [
          { address: USDC_ADDRESS, topics: encodeEventTopics({ abi: usdcEvents, eventName: "AuthorizationUsed", args: { authorizer: BUYER, nonce: p.nonce } }) as Hex[], data: "0x" },
          {
            address: USDC_ADDRESS,
            topics: encodeEventTopics({ abi: usdcEvents, eventName: "Transfer", args: { from: BUYER, to: SELLER } }) as Hex[],
            data: encodeAbiParameters([{ type: "uint256" }], [o.transferred ?? p.amount]),
          },
        ],
      };
    },
    async receiptSignerAt() {
      return o.signer ?? SIGNER;
    },
  };
}
