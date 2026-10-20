import { keccak256, toBytes, type Hex } from "viem";
import { canonical } from "../buyer/catalogue.js";
import { db } from "../db.js";
import { outputHash } from "./receipt.js";

db.exec(`
CREATE TABLE IF NOT EXISTS evidence (
  hash TEXT PRIMARY KEY,
  ledger_id INTEGER NOT NULL UNIQUE,
  bundle TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- 1 while a claim on it is open; pruning counts 30 days from closed_at (or created_at if no claim was filed).
  held INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER
);
`);
// Tables made before held/closed_at existed.
const evidenceColumns = (db.prepare("PRAGMA table_info(evidence)").all() as { name: string }[]).map((c) => c.name);
if (!evidenceColumns.includes("held")) db.exec("ALTER TABLE evidence ADD COLUMN held INTEGER NOT NULL DEFAULT 0");
if (!evidenceColumns.includes("closed_at")) db.exec("ALTER TABLE evidence ADD COLUMN closed_at INTEGER");

/** Larger bodies keep only their hash. 1 MB, not less, so a junk seller cannot pad its way out of a claim. */
export const MAX_EVIDENCE_BODY = 1_000_000;
const KEEP_MS = 30 * 24 * 3600_000;

/** Everything a verifier needs to re-check a paid-and-rejected call on its own. */
export interface EvidenceBundle {
  v: 1;
  chainId: number;
  ledgerId: number;
  serviceId: string;
  reason: string;
  payment: { payTo: string; payer: string; amount: string; nonce: string | null; txHash: string | null };
  request: { method: string; path: string; body: string };
  outputSchema: Record<string, unknown>;
  response: { status: number; body: string | null; bodyHash: Hex | null; receipt: string | null };
}

const insert = db.prepare("INSERT INTO evidence (hash, ledger_id, bundle, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(ledger_id) DO NOTHING");
const prune = db.prepare("DELETE FROM evidence WHERE held = 0 AND COALESCE(closed_at, created_at) < ?");
const byLedger = db.prepare("SELECT hash, bundle FROM evidence WHERE ledger_id = ?");
const byHash = db.prepare("SELECT bundle FROM evidence WHERE hash = ?");
const setHeld = db.prepare("UPDATE evidence SET held = ?, closed_at = ? WHERE hash = ?");

/** `body` is the raw response text (null if it never arrived). The id is the keccak of the bundle's canonical JSON. */
export function saveEvidence(e: Omit<EvidenceBundle, "v" | "response"> & { response: { status: number; body: string | null; receipt: string | null } }): Hex {
  const { body } = e.response;
  const bundle: EvidenceBundle = {
    ...e,
    v: 1,
    response: { ...e.response, body: body !== null && Buffer.byteLength(body) > MAX_EVIDENCE_BODY ? null : body, bodyHash: body === null ? null : outputHash(body) },
  };
  const json = canonical(bundle);
  const hash = keccak256(toBytes(json));
  const now = Date.now();
  prune.run(now - KEEP_MS);
  insert.run(hash, e.ledgerId, json, now);
  return hash;
}

/** `json` is the stored canonical text, so whoever fetches it can re-hash it byte for byte. */
export function getEvidence(hash: string): { json: string; bundle: EvidenceBundle } | undefined {
  const row = byHash.get(hash.toLowerCase()) as { bundle: string } | undefined;
  return row && { json: row.bundle, bundle: JSON.parse(row.bundle) };
}

/** Kept while a claim on it is open; released when the claim closes (deleted 30 days later). */
export const holdEvidence = (hash: string, held: boolean, now = Date.now()) => void setHeld.run(held ? 1 : 0, held ? null : now, hash.toLowerCase());

export function evidenceForLedger(ledgerId: number): { hash: Hex; bundle: EvidenceBundle } | undefined {
  const row = byLedger.get(ledgerId) as { hash: Hex; bundle: string } | undefined;
  return row && { hash: row.hash, bundle: JSON.parse(row.bundle) };
}
