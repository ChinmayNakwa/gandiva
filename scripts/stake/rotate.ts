// Replaces the SellerStakeV2 verifier set. 2 of the current 3 verifiers sign the new set; then the relayer submits it.
// Step 1, on 2 verifier hosts (prints a signature; signatures are safe to share):
//   npm run stake:rotate -- sign <v1> <v2> <v3>               (the first signer; it prints the deadline to reuse)
//   npm run stake:rotate -- sign <v1> <v2> <v3> <deadline>    (the second signer)
// Step 2, where RELAYER_PRIVATE_KEY is set:
//   npm run stake:rotate -- send <v1> <v2> <v3> <deadline> <sig> <sig>
// Env: VERIFIER_KEY (sign), RELAYER_PRIVATE_KEY (send), STAKE_CONTRACT, BASE_SEPOLIA_RPC (optional)
import "dotenv/config";
import { createPublicClient, http, isAddress, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "../../src/config.js";
import { rotateOnChain } from "../../src/stake/index.js";
import { rotateSignerOf, signRotate, type RotateMessage } from "../../src/stake/verify.js";

const USAGE = "usage: npm run stake:rotate -- sign <v1> <v2> <v3> [deadline]\n       npm run stake:rotate -- send <v1> <v2> <v3> <deadline> <sig> <sig>";
const [cmd, a, b, c, ...rest] = process.argv.slice(2);
const set = [a, b, c] as [Hex, Hex, Hex];
if ((cmd !== "sign" && cmd !== "send") || !set.every((x) => x && isAddress(x)) || new Set(set.map((x) => x.toLowerCase())).size !== 3) {
  console.log(USAGE);
  process.exit(1);
}
const contract = config.stake.contract as Hex;
if (!contract) throw new Error("STAKE_CONTRACT is not set");

const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const ABI = parseAbi(["function rotationNonce() view returns (uint256)", "function verifiers(uint256) view returns (address)"]);
const nonce = await pub.readContract({ address: contract, abi: ABI, functionName: "rotationNonce" });
const current = await Promise.all([0n, 1n, 2n].map((i) => pub.readContract({ address: contract, abi: ABI, functionName: "verifiers", args: [i] })));
const isCurrent = (x: string) => current.some((v) => v.toLowerCase() === x.toLowerCase());

if (cmd === "sign") {
  const key = process.env.VERIFIER_KEY as Hex | undefined;
  if (!key) throw new Error("VERIFIER_KEY is not set");
  const me = privateKeyToAccount(key).address;
  if (!isCurrent(me)) throw new Error(`${me} is not one of the current verifiers (${current.join(", ")})`);
  if (rest[0] !== undefined && !/^\d+$/.test(rest[0])) throw new Error("deadline must be unix seconds, as the first signer printed it");
  const deadline = rest[0] ? BigInt(rest[0]) : BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const signature = await signRotate(key, { set, nonce, deadline }, contract);
  console.log(`${me} signed the new set (rotation nonce ${nonce}, valid until ${new Date(Number(deadline) * 1000).toISOString()})`);
  console.log(`signature ${signature}`);
  if (!rest[0]) console.log(`second verifier: npm run stake:rotate -- sign ${set.join(" ")} ${deadline}`);
} else {
  const [deadlineArg, ...sigs] = rest;
  if (!/^\d+$/.test(deadlineArg ?? "") || sigs.length < 2) {
    console.log(USAGE);
    process.exit(1);
  }
  const m: RotateMessage = { set, nonce, deadline: BigInt(deadlineArg) };
  if (m.deadline < BigInt(Math.floor(Date.now() / 1000))) throw new Error("the deadline has passed; sign again");
  const bySigner = new Map<bigint, Hex>();
  for (const sig of sigs as Hex[]) {
    const who = await rotateSignerOf(m, sig, contract);
    if (!isCurrent(who)) throw new Error(`a signature comes from ${who}, not a current verifier (different set or deadline, or signed before another rotation?)`);
    bySigner.set(BigInt(who), sig);
  }
  if (bySigner.size < 2) throw new Error("need signatures from 2 different verifiers");
  // SellerStakeV2 wants them sorted by signer, ascending.
  const sorted = [...bySigner].sort(([x], [y]) => (x < y ? -1 : 1)).map(([, sig]) => sig);
  const r = await rotateOnChain(set, m.deadline, sorted);
  console.log(`verifiers are now ${set.join(", ")}  ${r.explorer}`);
}
