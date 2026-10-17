// Deploys SellerStake to Base Sepolia from the arbiter wallet and writes STAKE_CONTRACT into .env.
// Usage: npm run stake:deploy [-- <cooldown seconds, default 600>]
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config, USDC_ADDRESS } from "../../src/config.js";

if (!config.stake.arbiterKey) throw new Error("ARBITER_PRIVATE_KEY is not set (run npm run wallets:new)");
const artifact = JSON.parse(readFileSync("contracts/SellerStake.json", "utf8")) as { abi: Abi; bytecode: Hex };
const account = privateKeyToAccount(config.stake.arbiterKey);
const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(config.rpcUrl) });

const eth = await pub.getBalance({ address: account.address });
console.log(`arbiter ${account.address} holds ${formatEther(eth)} ETH`);
if (eth === 0n) {
  console.log("It needs a little Base Sepolia ETH for gas first (see the README, Staking section).");
  process.exit(1);
}

const cooldown = BigInt(process.argv[2] ?? "600");
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [USDC_ADDRESS, account.address, cooldown] });
console.log(`deploy tx ${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${receipt.status}`);

const ENV = ".env";
let text = readFileSync(ENV, "utf8");
text = /^STAKE_CONTRACT=.*$/m.test(text) ? text.replace(/^STAKE_CONTRACT=.*$/m, `STAKE_CONTRACT=${receipt.contractAddress}`) : `${text.trimEnd()}\nSTAKE_CONTRACT=${receipt.contractAddress}\n`;
writeFileSync(ENV, text);
console.log(`SellerStake deployed at ${receipt.contractAddress} (cooldown ${cooldown} s), saved to .env as STAKE_CONTRACT`);
console.log(`explorer: https://sepolia.basescan.org/address/${receipt.contractAddress}`);
