// Replay test: one signed payment sent twice in a row, then a fresh one sent 5 times in parallel.
// Expect exactly one 200 (with one tx hash) per signature; every other copy is rejected and moves no money.
// Usage: npm run judge:replay -- [sellerUrl]
import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { BASE } from "../lib.js";

const url = process.argv[2] || `${BASE}/sellers/fx-rates/rate?from=GBP&to=INR`;
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`) });

async function sign() {
  const res = await fetch(url);
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`);
  const pr = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
  return encodePaymentSignatureHeader(await client.createPaymentPayload(pr));
}

async function send(sig: string) {
  const res = await fetch(url, { headers: { "PAYMENT-SIGNATURE": sig } });
  const pr = res.headers.get("PAYMENT-RESPONSE");
  const tx = pr ? decodePaymentResponseHeader(pr).transaction : undefined;
  const body = await res.text();
  return { status: res.status, tx, body: body.slice(0, 120) };
}

function report(label: string, results: Awaited<ReturnType<typeof send>>[]) {
  const ok = results.filter((r) => r.status === 200);
  const txs = new Set(results.map((r) => r.tx).filter(Boolean));
  console.log(`\n${label}`);
  results.forEach((r, i) => console.log(`  #${i + 1} -> ${r.status}${r.tx ? ` tx ${r.tx}` : ""} ${r.status === 200 ? "" : r.body}`));
  const pass = ok.length === 1 && txs.size === 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}: ${ok.length} paid response(s), ${txs.size} transaction(s)`);
  return pass;
}

console.log(`target ${url}`);
const sigA = await sign();
const seq = [await send(sigA), await send(sigA)];
const p1 = report("Same signature sent twice, one after another:", seq);

const sigB = await sign();
const par = await Promise.all(Array.from({ length: 5 }, () => send(sigB)));
const p2 = report("Fresh signature sent 5 times in parallel:", par);

console.log(`\n${p1 && p2 ? "REPLAY TEST PASSED" : "REPLAY TEST FAILED"} - check the tx hashes on https://sepolia.basescan.org`);
process.exit(p1 && p2 ? 0 : 1);
