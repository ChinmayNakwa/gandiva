import { decodeEventLog, encodeAbiParameters, keccak256, parseAbi, recoverTypedDataAddress, toBytes, zeroAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { canonical } from "../buyer/catalogue.js";
import { USDC_ADDRESS } from "../config.js";
import { validate } from "../x402/schema.js";
import type { EvidenceBundle } from "./evidence.js";
import { decodeReceipt, outputHash, receiptSignerOf, requestHash, schemaHash, type SignedReceipt } from "./receipt.js";

/**
 * The check every SellerStakeV2 verifier runs before signing: the server's own and the outside ones (scripts/verifier.ts).
 * It trusts nothing but the evidence bundle's own hash, the chain and the seller's signature.
 */

export const CLAIM_DEADLINE_S = 3600n; // SellerStakeV2.CLAIM_DEADLINE
export const MAX_SLASH = 100_000n; // SellerStakeV2.MAX_SLASH

export interface ClaimMessage {
  seller: Hex;
  buyer: Hex;
  amount: bigint;
  paymentNonce: Hex;
  evidence: Hex;
  kind: number;
  deadline: bigint;
}

/** What a verifier reads from the chain; the server and the verifier script each back it with their own RPC. */
export interface ChainView {
  /** The settlement tx's block, time and logs, or null if the RPC does not know the tx (yet). */
  tx(hash: Hex): Promise<{ blockNumber: bigint; timestamp: bigint; logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[] } | null>;
  /** The seller's receipt signer at the end of `block` (zero address = none registered). */
  receiptSignerAt(seller: Hex, block: bigint): Promise<Hex>;
}

export type Verdict = { ok: true; kind: 1 | 2; message: ClaimMessage } | { ok: false; code: "retry" | "not_slashable" | "rejected"; reason: string };

const USDC_EVENTS = parseAbi(["event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);
const STAKE_ABI = parseAbi(["function receiptSigner(address) view returns (address)", "event ReceiptSignerSet(address indexed seller, address signer, address previous)"]);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function rpcChainView(pub: PublicClient, stake: Hex): ChainView {
  return {
    async tx(hash) {
      const receipt = await pub.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) return null;
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      return { blockNumber: receipt.blockNumber, timestamp: block.timestamp, logs: receipt.logs };
    },
    // Public RPCs keep only recent state, so read today's signer and walk back through the events since `block`.
    async receiptSignerAt(seller, block) {
      const head = await pub.getBlockNumber();
      const [current, changes] = await Promise.all([
        pub.readContract({ address: stake, abi: STAKE_ABI, functionName: "receiptSigner", args: [seller], blockNumber: head }),
        pub.getLogs({ address: stake, event: STAKE_ABI[1], args: { seller }, fromBlock: block + 1n, toBlock: head }),
      ]);
      return (changes.length ? changes[0].args.previous! : current) as Hex;
    },
  };
}

/** The seller's payment as the chain shows it: the USDC authorization used and the transfer to the seller. */
async function provePayment(b: EvidenceBundle, chain: ChainView): Promise<{ ok: true; block: bigint; time: bigint } | Extract<Verdict, { ok: false }>> {
  const { txHash, nonce, payer, payTo, amount } = b.payment;
  if (!txHash || !nonce) return { ok: false, code: "rejected", reason: "the evidence names no settlement tx or payment nonce" };
  const tx = await chain.tx(txHash as Hex);
  if (!tx) return { ok: false, code: "retry", reason: "settlement tx not found (yet)" };
  let authorized = false;
  let transferred = false;
  for (const log of tx.logs) {
    if (!same(log.address, USDC_ADDRESS)) continue;
    try {
      const e = decodeEventLog({ abi: USDC_EVENTS, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (e.eventName === "AuthorizationUsed" && same(e.args.authorizer, payer) && same(e.args.nonce, nonce)) authorized = true;
      if (e.eventName === "Transfer" && same(e.args.from, payer) && same(e.args.to, payTo) && e.args.value === BigInt(amount)) transferred = true;
    } catch {}
  }
  if (!authorized || !transferred) return { ok: false, code: "rejected", reason: "the settlement tx does not show this payment" };
  return { ok: true, block: tx.blockNumber, time: tx.timestamp };
}

/** A receipt from the registered signer, for this payment, over exactly the request, body and schema in the evidence. */
async function receiptCovers(s: SignedReceipt, b: EvidenceBundle, body: string, signer: Hex): Promise<boolean> {
  const r = s.receipt;
  return (
    same(await receiptSignerOf(s).catch(() => null), signer) &&
    same(r.payTo, b.payment.payTo) &&
    same(r.payer, b.payment.payer) &&
    same(r.paymentNonce, b.payment.nonce) &&
    r.requestHash === requestHash(b.request.method, b.request.path, b.request.body) &&
    r.outputHash === outputHash(body) &&
    r.schemaHash === schemaHash(b.outputSchema)
  );
}

function fitsSchema(schema: Record<string, unknown>, body: string): boolean {
  try {
    return validate(schema, JSON.parse(body)).ok;
  } catch {
    return false;
  }
}

/**
 * Kind 1: a receipt from the seller's registered signer covers this payment and its output breaks the signed schema (or
 * the seller signed an error status). Kind 2: paid on chain, no valid receipt came back; the seller can rebut it.
 */
export async function checkClaim(hash: Hex, b: EvidenceBundle, chain: ChainView, nowS = BigInt(Math.floor(Date.now() / 1000))): Promise<Verdict> {
  if (keccak256(toBytes(canonical(b))) !== hash) return { ok: false, code: "rejected", reason: "the bundle does not match its hash" };
  if (b.chainId !== baseSepolia.id) return { ok: false, code: "rejected", reason: `wrong chain ${b.chainId}` };
  const paid = await provePayment(b, chain);
  if (!paid.ok) return paid;
  const deadline = paid.time + CLAIM_DEADLINE_S;
  if (nowS > deadline) return { ok: false, code: "rejected", reason: "the claim deadline (1 h after the payment) has passed" };
  const signer = await chain.receiptSignerAt(b.payment.payTo as Hex, paid.block);
  if (signer === zeroAddress) return { ok: false, code: "not_slashable", reason: "the seller had no receipt signer registered when it was paid" };

  // A receipt that does not cover exactly this payment and body counts as no receipt (kind 2, which the seller can rebut),
  // so a seller cannot dodge a claim by signing something deliberately off.
  let kind: 1 | 2 = 2;
  const signed = decodeReceipt(b.response.receipt);
  const body = b.response.body;
  if (signed && body !== null && (await receiptCovers(signed, b, body, signer))) {
    if (signed.receipt.httpStatus < 400 && fitsSchema(b.outputSchema, body)) return { ok: false, code: "rejected", reason: "the output fits the schema the seller signed" };
    kind = 1;
  }
  const amount = BigInt(b.payment.amount) < MAX_SLASH ? BigInt(b.payment.amount) : MAX_SLASH;
  return { ok: true, kind, message: { seller: b.payment.payTo as Hex, buyer: b.payment.payer as Hex, amount, paymentNonce: b.payment.nonce as Hex, evidence: hash, kind, deadline } };
}

/** A seller's answer to a kind 2 claim: a valid receipt for this payment over output that fits the signed schema. */
export async function checkRebuttal(b: EvidenceBundle, rebuttal: { receipt: string; body: string }, chain: ChainView): Promise<{ ok: boolean; reason: string }> {
  const paid = await provePayment(b, chain);
  if (!paid.ok) return { ok: false, reason: paid.reason };
  const signer = await chain.receiptSignerAt(b.payment.payTo as Hex, paid.block);
  const signed = decodeReceipt(rebuttal.receipt);
  if (!signed || signer === zeroAddress || !(await receiptCovers(signed, b, rebuttal.body, signer))) return { ok: false, reason: "the receipt is not the seller's for this payment and body" };
  if (signed.receipt.httpStatus >= 400 || !fitsSchema(b.outputSchema, rebuttal.body)) return { ok: false, reason: "the rebuttal output does not fit the schema" };
  return { ok: true, reason: "valid receipt over valid output" };
}

// ---- the signatures verifiers give (must match SellerStakeV2's EIP-712 types) ----

export const stakeDomain = (verifyingContract: Hex, chainId: number | bigint = baseSepolia.id) => ({ name: "Gandiva SellerStake", version: "2", chainId: BigInt(chainId), verifyingContract }) as const;
const CLAIM_TYPES = {
  Claim: [
    { name: "seller", type: "address" },
    { name: "buyer", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paymentNonce", type: "bytes32" },
    { name: "evidence", type: "bytes32" },
    { name: "kind", type: "uint8" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const VETO_TYPES = { Veto: [{ name: "id", type: "bytes32" }, { name: "deadline", type: "uint256" }] } as const;

export const claimIdOf = (seller: Hex, buyer: Hex, paymentNonce: Hex) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "bytes32" }], [seller, buyer, paymentNonce]));
export const signClaim = (key: Hex, m: ClaimMessage, contract: Hex, chainId?: number | bigint) =>
  privateKeyToAccount(key).signTypedData({ domain: stakeDomain(contract, chainId), types: CLAIM_TYPES, primaryType: "Claim", message: m });
export const claimSignerOf = (m: ClaimMessage, signature: Hex, contract: Hex, chainId?: number | bigint) =>
  recoverTypedDataAddress({ domain: stakeDomain(contract, chainId), types: CLAIM_TYPES, primaryType: "Claim", message: m, signature });
export const signVeto = (key: Hex, v: { id: Hex; deadline: bigint }, contract: Hex, chainId?: number | bigint) =>
  privateKeyToAccount(key).signTypedData({ domain: stakeDomain(contract, chainId), types: VETO_TYPES, primaryType: "Veto", message: v });
export const vetoSignerOf = (v: { id: Hex; deadline: bigint }, signature: Hex, contract: Hex, chainId?: number | bigint) =>
  recoverTypedDataAddress({ domain: stakeDomain(contract, chainId), types: VETO_TYPES, primaryType: "Veto", message: v, signature });

/** A new verifier set, signed by 2 of the current 3 against the contract's rotationNonce. */
export interface RotateMessage {
  set: [Hex, Hex, Hex];
  nonce: bigint;
  deadline: bigint;
}
const ROTATE_TYPES = {
  Rotate: [
    { name: "verifier1", type: "address" },
    { name: "verifier2", type: "address" },
    { name: "verifier3", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const rotateMessage = (r: RotateMessage) => ({ verifier1: r.set[0], verifier2: r.set[1], verifier3: r.set[2], nonce: r.nonce, deadline: r.deadline });
export const signRotate = (key: Hex, r: RotateMessage, contract: Hex, chainId?: number | bigint) =>
  privateKeyToAccount(key).signTypedData({ domain: stakeDomain(contract, chainId), types: ROTATE_TYPES, primaryType: "Rotate", message: rotateMessage(r) });
export const rotateSignerOf = (r: RotateMessage, signature: Hex, contract: Hex, chainId?: number | bigint) =>
  recoverTypedDataAddress({ domain: stakeDomain(contract, chainId), types: ROTATE_TYPES, primaryType: "Rotate", message: rotateMessage(r), signature });
