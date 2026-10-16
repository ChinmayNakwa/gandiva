import { createPublicClient, erc20Abi, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config, fromUnits, USDC_ADDRESS } from "../src/config.js";

const client = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const wallets: [string, string][] = [];
if (config.buyerPrivateKey) wallets.push(["buyer (Scout)", privateKeyToAccount(config.buyerPrivateKey).address]);
for (const [k, v] of Object.entries(config.payTo)) if (v) wallets.push([k, v]);

for (const [name, address] of wallets) {
  const bal = await client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
  console.log(`${name.padEnd(16)} ${address}  ${fromUnits(bal)} USDC`);
}
