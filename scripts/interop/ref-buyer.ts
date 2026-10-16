// A reference buyer built only from the unmodified x402 v2 SDK (@x402/fetch), paying one of our sellers.
// Usage: npm run interop:ref-buyer -- [url]
import "dotenv/config";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { BASE } from "../lib.js";

const info = await fetch(`${BASE}/api/info`).then((r) => r.json()).catch(() => null);
const url = process.argv[2] || `${info?.publicBaseUrl ?? BASE}/sellers/fx-rates/rate?from=GBP&to=INR`;
if (!/^https?:\/\//.test(url)) {
  console.error(`not a URL: ${url}\nPass a full URL, e.g. https://<your-tunnel>/sellers/fx-rates/rate?from=GBP&to=INR, or omit it to use the server's public URL.`);
  process.exit(1);
}
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

console.log(`standard @x402/fetch client ${account.address} -> ${url}`);
const res = await fetchWithPayment(url);
console.log("status", res.status);
console.log("body", await res.text());
const pr = res.headers.get("PAYMENT-RESPONSE");
if (pr) {
  const s = decodePaymentResponseHeader(pr);
  console.log("PAYMENT-RESPONSE", s);
  if (s.transaction) console.log(`explorer: https://sepolia.basescan.org/tx/${s.transaction}`);
}
