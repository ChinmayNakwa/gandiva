// Seller failure test: pay (with a standard x402 client) for a request our seller cannot fulfil.
// Expect an error back, no PAYMENT-RESPONSE, and an unchanged buyer USDC balance.
import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, erc20Abi, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BASE } from "../lib.js";

const url = process.argv[2] || `${BASE}/sellers/shelf-scraper/scrape?page=999`;
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`);
const chain = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org") });
const balance = () => chain.readContract({ address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

const before = await balance();
const first = await fetch(url);
const pr = decodePaymentRequiredHeader(first.headers.get("PAYMENT-REQUIRED")!);
const sig = encodePaymentSignatureHeader(await client.createPaymentPayload(pr));
const res = await fetch(url, { headers: { "PAYMENT-SIGNATURE": sig } });
const body = await res.text();
await new Promise((r) => setTimeout(r, 4000));
const after = await balance();

console.log(`request ${url}\n  -> ${res.status} ${body.slice(0, 200)}`);
console.log(`  PAYMENT-RESPONSE header: ${res.headers.get("PAYMENT-RESPONSE") ? "present" : "absent"}`);
console.log(`  buyer balance before ${before}, after ${after}`);
const pass = res.status >= 400 && !res.headers.get("PAYMENT-RESPONSE") && before === after;
console.log(pass ? "SELLER FAILURE TEST PASSED" : "SELLER FAILURE TEST FAILED");
process.exit(pass ? 0 : 1);
