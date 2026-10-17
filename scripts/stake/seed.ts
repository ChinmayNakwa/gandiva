// Stakes part of each built-in seller's testnet earnings into SellerStake, through the running server's relay.
// The sellers sign gasless EIP-3009 authorisations; the server's arbiter pays the gas.
// Usage: npm run stake:seed   (with the server running; GANDIVA_URL to target a public one)
import "dotenv/config";
import { createPublicClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config, fromUnits, USDC_ADDRESS } from "../../src/config.js";
import { signStakeWithKey } from "../../src/stake/index.js";
import { api } from "../lib.js";

// [seller, stake target in units]. junk-fx stakes too, so the junk test shows its bond refunding the buyer.
const plan: [string, bigint][] = [
  ["SHELF_SCRAPER", 200_000n],
  ["HINDI_SUMMARY", 100_000n],
  ["FX_RATES", 50_000n],
  ["CITY_INFO", 20_000n],
  ["SENTIMENT", 20_000n],
  ["JUNK_FX", 5_000n],
];

const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const info = await api<any>("/registry/stake");
if (!info.enabled) {
  console.log("Staking is not enabled on the server (deploy with npm run stake:deploy, then restart the server).");
  process.exit(1);
}
for (const [name, target] of plan) {
  const key = process.env[`SELLER_KEY_${name}`] as Hex | undefined;
  if (!key) continue;
  const address = privateKeyToAccount(key).address;
  const pos = await api<any>(`/registry/stake/${address}`);
  const need = target - BigInt(pos.staked);
  if (need <= 0n) {
    console.log(`${name.toLowerCase().padEnd(14)} already staked ${fromUnits(pos.staked)} USDC`);
    continue;
  }
  const held = await pub.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  const amount = need < held ? need : held;
  if (amount < 5_000n) {
    console.log(`${name.toLowerCase().padEnd(14)} holds only ${fromUnits(held)} USDC; skipped (earn or fund ${address} first)`);
    continue;
  }
  const signed = await signStakeWithKey(key, amount);
  const r = await api<any>("/registry/stake", signed);
  console.log(`${name.toLowerCase().padEnd(14)} staked ${fromUnits(amount)} USDC, now ${r.position.stakedUsdc}  ${r.explorer}`);
}
