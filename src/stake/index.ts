import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mutex } from "async-mutex";
import { createPublicClient, createWalletClient, http, keccak256, parseSignature, toBytes, verifyTypedData, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config, EXPLORER_TX, fromUnits, USDC_ADDRESS, USDC_EIP712 } from "../config.js";
import { db } from "../db.js";

/** Smallest stake worth relaying (the arbiter pays the gas) and the largest single authorisation we accept. */
export const MIN_STAKE = 5_000n;
export const MAX_STAKE = 5_000_000n;

const artifact = JSON.parse(readFileSync(fileURLToPath(new URL("../../contracts/SellerStake.json", import.meta.url)), "utf8")) as { abi: Abi };
const abi = artifact.abi;

db.exec(`
CREATE TABLE IF NOT EXISTS stake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  seller TEXT NOT NULL,
  counterparty TEXT,
  amount TEXT NOT NULL DEFAULT '0',
  tx_hash TEXT,
  ledger_id INTEGER,
  status TEXT NOT NULL,
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS stake_events_slash_once ON stake_events (ledger_id) WHERE kind = 'slash';
`);

export class StakeError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 503 = 400) {
    super(message);
  }
}

/** Unit tests never touch the chain, even when .env names a deployed contract. */
export const stakeEnabled = () => Boolean(config.stake.contract && config.stake.arbiterKey && !process.env.VITEST);

const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
let arbiterWallet: ReturnType<typeof makeArbiter> | null = null;
function makeArbiter() {
  const account = privateKeyToAccount(config.stake.arbiterKey as Hex);
  return { account, client: createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) }) };
}
const arbiter = () => (arbiterWallet ??= makeArbiter());
// One transaction at a time from the arbiter, so concurrent slashes and relays never reuse a nonce.
const sendLock = new Mutex();

const contract = () => {
  if (!stakeEnabled()) throw new StakeError("staking is not configured on this server (STAKE_CONTRACT / ARBITER_PRIVATE_KEY)", 503);
  return config.stake.contract as Hex;
};

async function send(functionName: string, args: unknown[]): Promise<{ hash: Hex; block: bigint }> {
  const address = contract();
  return sendLock.runExclusive(async () => {
    // Simulating first means a call that would revert costs the arbiter no gas.
    const { request } = await pub.simulateContract({ account: arbiter().account, address, abi, functionName, args });
    const hash = await arbiter().client.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new StakeError(`${functionName} reverted (tx ${hash})`, 409);
    return { hash, block: receipt.blockNumber };
  });
}

const cache = new Map<string, { at: number; value: StakePosition }>();
export interface StakePosition {
  staked: string;
  stakedUsdc: string;
  /** Unix seconds after which the bond can be withdrawn; 0 = not unstaking. */
  unlockAt: number;
}
const EMPTY: StakePosition = { staked: "0", stakedUsdc: "0.000000", unlockAt: 0 };

/**
 * Reads a seller's bond from the contract (cached for 20 s). Zero when staking is off or the chain cannot be reached.
 * `atBlock` pins the read to the block of our own write: the public RPC is load-balanced and "latest" can lag behind it.
 */
export async function stakeOf(seller: string, fresh = false, atBlock?: bigint): Promise<StakePosition> {
  if (!stakeEnabled()) return EMPTY;
  const key = seller.toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.value;
  const address = contract();
  for (let attempt = 0; attempt < (atBlock ? 5 : 1); attempt++) {
    try {
      const [staked, unlockAt] = await Promise.all([
        pub.readContract({ address, abi, functionName: "stakeOf", args: [seller], blockNumber: atBlock }) as Promise<bigint>,
        pub.readContract({ address, abi, functionName: "unlockAt", args: [seller], blockNumber: atBlock }) as Promise<bigint>,
      ]);
      const value = { staked: staked.toString(), stakedUsdc: fromUnits(staked), unlockAt: Number(unlockAt) };
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch {
      if (atBlock) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return hit?.value ?? EMPTY;
}

let infoCache: { at: number; cooldown: number; total: string } | null = null;
export async function stakeInfo() {
  if (!stakeEnabled()) return { enabled: false as const };
  if (!infoCache || Date.now() - infoCache.at > 30_000) {
    const address = contract();
    const [cooldown, total] = await Promise.all([
      pub.readContract({ address, abi, functionName: "cooldown" }) as Promise<bigint>,
      pub.readContract({ address, abi, functionName: "totalStaked" }) as Promise<bigint>,
    ]);
    infoCache = { at: Date.now(), cooldown: Number(cooldown), total: total.toString() };
  }
  return {
    enabled: true as const,
    contract: config.stake.contract,
    arbiter: arbiter().account.address,
    cooldownSeconds: infoCache.cooldown,
    totalStaked: infoCache.total,
    totalStakedUsdc: fromUnits(infoCache.total),
    minStake: MIN_STAKE.toString(),
    explorer: `https://sepolia.basescan.org/address/${config.stake.contract}`,
  };
}

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
const usdcDomain = { name: USDC_EIP712.name, version: USDC_EIP712.version, chainId: baseSepolia.id, verifyingContract: USDC_ADDRESS as Hex } as const;

/** EIP-712 data the seller signs in its wallet to stake `amount` units. Signing costs nothing; the arbiter relays it. */
export function prepareStake(seller: string, amount: bigint) {
  if (amount < MIN_STAKE || amount > MAX_STAKE) throw new StakeError(`stake must be between ${fromUnits(MIN_STAKE)} and ${fromUnits(MAX_STAKE)} USDC`);
  const message = {
    from: seller as Hex,
    to: contract(),
    value: amount.toString(),
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  return { domain: usdcDomain, types: RECEIVE_TYPES, primaryType: "ReceiveWithAuthorization" as const, message };
}

export interface SignedStake {
  from: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
}

/** Relays a signed stake to the contract. The signature is checked here first so a bad one never costs gas. */
export async function relayStake(s: SignedStake): Promise<{ txHash: string; explorer: string; position: StakePosition }> {
  const to = contract();
  const value = BigInt(s.value);
  if (value < MIN_STAKE || value > MAX_STAKE) throw new StakeError(`stake must be between ${fromUnits(MIN_STAKE)} and ${fromUnits(MAX_STAKE)} USDC`);
  const message = { from: s.from as Hex, to, value, validAfter: BigInt(s.validAfter), validBefore: BigInt(s.validBefore), nonce: s.nonce as Hex };
  const ok = await verifyTypedData({ address: s.from as Hex, domain: usdcDomain, types: RECEIVE_TYPES, primaryType: "ReceiveWithAuthorization", message, signature: s.signature as Hex }).catch(() => false);
  if (!ok) throw new StakeError("the stake signature does not match the seller and amount");
  const { r, s: sv, v, yParity } = parseSignature(s.signature as Hex);
  let sent: { hash: Hex; block: bigint };
  try {
    sent = await send("stakeWithAuthorization", [message.from, value, message.validAfter, message.validBefore, message.nonce, Number(v ?? BigInt(yParity + 27)), r, sv]);
  } catch (err: any) {
    record({ kind: "stake", seller: s.from, amount: s.value, status: "failed", note: shortError(err) });
    throw err instanceof StakeError ? err : new StakeError(`stake rejected: ${shortError(err)}`, 409);
  }
  const txHash = sent.hash;
  infoCache = null;
  record({ kind: "stake", seller: s.from, amount: s.value, txHash, status: "done" });
  return { txHash, explorer: EXPLORER_TX + txHash, position: await stakeOf(s.from, true, sent.block) };
}

/** Signs a stake with a private key we hold (the built-in sellers' testnet wallets). */
export async function signStakeWithKey(privateKey: Hex, amount: bigint): Promise<SignedStake> {
  const account = privateKeyToAccount(privateKey);
  const typed = prepareStake(account.address, amount);
  const signature = await account.signTypedData({ ...typed, message: { ...typed.message, value: BigInt(typed.message.value), validAfter: 0n, validBefore: BigInt(typed.message.validBefore) } });
  return { from: account.address, value: typed.message.value, validAfter: "0", validBefore: typed.message.validBefore, nonce: typed.message.nonce, signature };
}

const UNSTAKE_TYPES = {
  Unstake: [
    { name: "seller", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const stakeDomain = () => ({ name: "Gandiva SellerStake", version: "1", chainId: baseSepolia.id, verifyingContract: contract() }) as const;

export async function prepareUnstake(seller: string) {
  const nonce = (await pub.readContract({ address: contract(), abi, functionName: "nonces", args: [seller] })) as bigint;
  return { domain: stakeDomain(), types: UNSTAKE_TYPES, primaryType: "Unstake" as const, message: { seller, nonce: nonce.toString(), deadline: String(Math.floor(Date.now() / 1000) + 3600) } };
}

export async function relayUnstake(u: { seller: string; deadline: string; signature: string }) {
  const { r, s, v, yParity } = parseSignature(u.signature as Hex);
  let sent: { hash: Hex; block: bigint };
  try {
    sent = await send("requestUnstakeWithSig", [u.seller, BigInt(u.deadline), Number(v ?? BigInt(yParity + 27)), r, s]);
  } catch (err: any) {
    throw err instanceof StakeError ? err : new StakeError(`unstake rejected: ${shortError(err)}`, 409);
  }
  const txHash = sent.hash;
  record({ kind: "unstake", seller: u.seller, txHash, status: "done" });
  return { txHash, explorer: EXPLORER_TX + txHash, position: await stakeOf(u.seller, true, sent.block) };
}

/** Releases a bond whose cooldown is over. Anyone may ask; the money only ever goes back to the seller. */
export async function withdrawFor(seller: string) {
  const before = await stakeOf(seller, true);
  let sent: { hash: Hex; block: bigint };
  try {
    sent = await send("withdraw", [seller]);
  } catch (err: any) {
    throw err instanceof StakeError ? err : new StakeError(`withdraw rejected: ${shortError(err)}`, 409);
  }
  const txHash = sent.hash;
  infoCache = null;
  record({ kind: "withdraw", seller, amount: before.staked, txHash, status: "done" });
  return { txHash, explorer: EXPLORER_TX + txHash, position: await stakeOf(seller, true, sent.block) };
}

/**
 * A paid call whose output broke the seller's own published schema is proven junk: refund the buyer what it paid, out of
 * the seller's bond (never more than is staked). Each ledger row is slashed at most once. Never throws.
 */
export async function slashForJunk(j: { ledgerId: number; seller: string; buyer: string; paid: bigint; txHash?: string | null; service: string }) {
  if (!stakeEnabled() || j.paid <= 0n) return;
  try {
    const pos = await stakeOf(j.seller, true);
    if (BigInt(pos.staked) === 0n) return;
    const claimed = db
      .prepare("INSERT OR IGNORE INTO stake_events (ts,kind,seller,counterparty,amount,ledger_id,status,note) VALUES (?,?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), "slash", j.seller, j.buyer, j.paid.toString(), j.ledgerId, "pending", `${j.service}: output broke its schema`);
    if (!claimed.changes) return;
    const evidence = keccak256(toBytes(`gandiva:ledger:${j.ledgerId}:${j.txHash ?? ""}`));
    try {
      const { hash: txHash } = await send("slash", [j.seller, j.buyer, j.paid, evidence]);
      infoCache = null;
      const amount = BigInt(pos.staked) < j.paid ? BigInt(pos.staked) : j.paid;
      db.prepare("UPDATE stake_events SET status = 'done', tx_hash = ?, amount = ? WHERE ledger_id = ? AND kind = 'slash'").run(txHash, amount.toString(), j.ledgerId);
      cache.delete(j.seller.toLowerCase());
    } catch (err: any) {
      db.prepare("UPDATE stake_events SET status = 'failed', note = ? WHERE ledger_id = ? AND kind = 'slash'").run(`slash failed: ${shortError(err)}`, j.ledgerId);
    }
  } catch (err: any) {
    console.error(`[stake] slash for ledger #${j.ledgerId} failed: ${shortError(err)}`);
  }
}

function record(e: { kind: string; seller: string; counterparty?: string; amount?: string; txHash?: string; status: string; note?: string }) {
  db.prepare("INSERT INTO stake_events (ts,kind,seller,counterparty,amount,tx_hash,status,note) VALUES (?,?,?,?,?,?,?,?)").run(
    new Date().toISOString(), e.kind, e.seller, e.counterparty ?? null, e.amount ?? "0", e.txHash ?? null, e.status, e.note ?? null,
  );
}

export function listStakeEvents(q: { seller?: string; limit?: number } = {}) {
  const rows = q.seller
    ? db.prepare("SELECT * FROM stake_events WHERE lower(seller) = ? ORDER BY id DESC LIMIT ?").all(q.seller.toLowerCase(), q.limit ?? 200)
    : db.prepare("SELECT * FROM stake_events ORDER BY id DESC LIMIT ?").all(q.limit ?? 200);
  return (rows as any[]).map((r) => ({ ...r, explorer: r.tx_hash ? EXPLORER_TX + r.tx_hash : null }));
}

/** Refunds paid out of a seller's bond so far (successful slashes). */
export function slashedTotal(seller: string): { count: number; amount: bigint } {
  const rows = db.prepare("SELECT amount FROM stake_events WHERE kind = 'slash' AND status = 'done' AND lower(seller) = ?").all(seller.toLowerCase()) as { amount: string }[];
  return { count: rows.length, amount: rows.reduce((a, r) => a + BigInt(r.amount), 0n) };
}

const shortError = (err: any) => String(err?.shortMessage ?? err?.message ?? err).split("\n")[0].slice(0, 200);
