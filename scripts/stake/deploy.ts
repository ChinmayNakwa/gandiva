// Deploys SellerStakeV2 to Base Sepolia from the relayer wallet and writes STAKE_CONTRACT into .env.
// Usage: npm run stake:deploy [-- <cooldown seconds, default 7200>]
// VERIFIER_ADDRESSES in .env: the three verifiers' addresses, comma-separated (addresses only; each key stays on its host).
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, isAddress, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config, USDC_ADDRESS } from "../../src/config.js";

if (!config.stake.relayerKey) throw new Error("RELAYER_PRIVATE_KEY is not set (run npm run wallets:new)");
const verifiers = (process.env.VERIFIER_ADDRESSES ?? "").split(",").map((a) => a.trim());
if (verifiers.length !== 3 || !verifiers.every((a) => isAddress(a)) || new Set(verifiers.map((a) => a.toLowerCase())).size !== 3) {
  throw new Error("VERIFIER_ADDRESSES must be three different 0x addresses, comma-separated");
}
const artifact = JSON.parse(readFileSync("contracts/SellerStakeV2.json", "utf8")) as { abi: Abi; bytecode: Hex };
const account = privateKeyToAccount(config.stake.relayerKey);
const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) });

const eth = await pub.getBalance({ address: account.address });
console.log(`relayer ${account.address} holds ${formatEther(eth)} ETH`);
if (eth === 0n) {
  console.log("It needs a little Base Sepolia ETH for gas first (see the README, Staking section).");
  process.exit(1);
}

// The contract refuses anything not longer than the 1 h claim deadline plus the 30 min window.
const cooldown = BigInt(process.argv[2] ?? "7200");
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [USDC_ADDRESS, verifiers, cooldown] });
console.log(`deploy tx ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${receipt.status}`);

const ENV = ".env";
let text = readFileSync(ENV, "utf8");
text = /^STAKE_CONTRACT=.*$/m.test(text) ? text.replace(/^STAKE_CONTRACT=.*$/m, `STAKE_CONTRACT=${receipt.contractAddress}`) : `${text.trimEnd()}\nSTAKE_CONTRACT=${receipt.contractAddress}\n`;
writeFileSync(ENV, text);
console.log(`SellerStakeV2 deployed at ${receipt.contractAddress} (cooldown ${cooldown} s, verifiers ${verifiers.join(", ")}), saved to .env as STAKE_CONTRACT`);
console.log(`explorer: https://sepolia.basescan.org/address/${receipt.contractAddress}`);
