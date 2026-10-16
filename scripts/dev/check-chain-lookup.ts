// Read-only check of the chain lookup the resolver relies on (no payments are made).
// Takes the most recent settled authorisations from the local seller DB and asks the chain about each one:
// the lookup must find the same tx hash the seller recorded, and a random nonce must come back as "unused".
import { randomBytes } from "node:crypto";
import { db } from "../../src/db.js";
import { chainTime, lookupAuthorization } from "../../src/x402/chain.js";

const rows = db.prepare("SELECT key, tx_hash, created_at FROM nonces WHERE status = 'settled' AND tx_hash IS NOT NULL ORDER BY rowid DESC LIMIT 3").all() as {
  key: string;
  tx_hash: string;
  created_at: string;
}[];

let failed = 0;
const now = await chainTime();
console.log(`chain time ${new Date(now * 1000).toISOString()}`);

for (const r of rows) {
  const [from, nonce] = r.key.split(":");
  if (!from?.startsWith("0x") || !nonce?.startsWith("0x")) continue;
  const signedAt = Math.floor(new Date(r.created_at.replace(" ", "T") + "Z").getTime() / 1000);
  const t0 = Date.now();
  const out = await lookupAuthorization({ from, nonce, validBefore: signedAt + 120, signedAt }, now);
  const ok = out.state === "used" && out.txHash.toLowerCase() === r.tx_hash.toLowerCase();
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} settled nonce ${nonce.slice(0, 12)}…: ${out.state}${out.state === "used" ? ` tx ${out.txHash.slice(0, 14)}… amount ${out.amount}` : ""} (${Date.now() - t0} ms)`);
}
if (!rows.length) console.log("no settled authorisations in the local DB yet; run a task first to test the positive case");

const fresh = await lookupAuthorization({ from: "0x" + "ab".repeat(20), nonce: "0x" + randomBytes(32).toString("hex"), validBefore: now - 10, signedAt: now - 130 }, now);
const okFresh = fresh.state === "unused" && fresh.expired;
if (!okFresh) failed++;
console.log(`${okFresh ? "PASS" : "FAIL"} random nonce: ${fresh.state}${fresh.state === "unused" ? ` (expired=${fresh.expired})` : ""}`);

process.exit(failed ? 1 : 0);
