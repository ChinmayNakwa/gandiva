// Looks for the buyer's testnet USDC on chains the Circle faucet supports, to catch a wrong-network faucet pick.
import { createPublicClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, fromUnits } from "../../src/config.js";

const buyer = privateKeyToAccount(config.buyerPrivateKey as `0x${string}`).address;
const chains: [string, string, `0x${string}`][] = [
  ["Base Sepolia", "https://sepolia.base.org", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"],
  ["Ethereum Sepolia", "https://ethereum-sepolia-rpc.publicnode.com", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"],
  ["Arbitrum Sepolia", "https://sepolia-rollup.arbitrum.io/rpc", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"],
  ["OP Sepolia", "https://sepolia.optimism.io", "0x5fd84259d66Cd46123540766Be93DFE6D43130D7"],
  ["Polygon Amoy", "https://rpc-amoy.polygon.technology", "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"],
];
console.log(`buyer ${buyer}`);
for (const [name, rpc, usdc] of chains) {
  try {
    const client = createPublicClient({ transport: http(rpc) });
    const bal = await client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [buyer] });
    console.log(`${name.padEnd(18)} ${fromUnits(bal)} USDC`);
  } catch (err: any) {
    console.log(`${name.padEnd(18)} error: ${err.shortMessage ?? err.message}`);
  }
}
