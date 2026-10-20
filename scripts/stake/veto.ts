// Vetoes a pending SellerStakeV2 claim by hand, e.g. one whose refund keeps reverting (a USDC-blacklisted buyer) and so
// blocks the seller's withdraw. 2 of the 3 verifiers sign; then the relayer submits. The server's claim worker sees the
// veto on chain and closes the claim as vetoed.
// Step 1, with VERIFIER_KEY set to each of 2 verifiers' keys (prints a signature; signatures are safe to share):
//   npm run stake:veto -- sign <claim id>               (the first signer; it prints the deadline to reuse)
//   npm run stake:veto -- sign <claim id> <deadline>    (the second signer)
// Step 2, where RELAYER_PRIVATE_KEY is set:
//   npm run stake:veto -- send <claim id> <deadline> <sig> <sig>
// <claim id> is the 0x… claimId from GET /registry/stake/claims?state=proposed.
// Env: VERIFIER_KEY (sign), RELAYER_PRIVATE_KEY (send), STAKE_CONTRACT, BASE_SEPOLIA_RPC (optional)
import "dotenv/config";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "../../src/config.js";
import { vetoOnChain } from "../../src/stake/index.js";
import { signVeto, vetoSignerOf } from "../../src/stake/verify.js";

const USAGE = "usage: npm run stake:veto -- sign <claim id> [deadline]\n       npm run stake:veto -- send <claim id> <deadline> <sig> <sig>";
const [cmd, id, ...rest] = process.argv.slice(2) as [string, Hex, ...string[]];
if ((cmd !== "sign" && cmd !== "send") || !/^0x[0-9a-fA-F]{64}$/.test(id ?? "")) {
  console.log(USAGE);
  process.exit(1);
}
const contract = config.stake.contract as Hex;
if (!contract) throw new Error("STAKE_CONTRACT is not set");

const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
const ABI = parseAbi([
  "function verifiers(uint256) view returns (address)",
  "function claims(bytes32) view returns (address seller, address buyer, uint256 amount, uint256 executeAfter, uint8 status)",
]);
const [, , , , status] = await pub.readContract({ address: contract, abi: ABI, functionName: "claims", args: [id] });
if (status !== 1) throw new Error(`claim ${id} is not pending on chain (status ${status}: 0 none, 2 executed, 3 vetoed)`);
const current = await Promise.all([0n, 1n, 2n].map((i) => pub.readContract({ address: contract, abi: ABI, functionName: "verifiers", args: [i] })));
const isCurrent = (x: string) => current.some((v) => v.toLowerCase() === x.toLowerCase());

if (cmd === "sign") {
  const key = process.env.VERIFIER_KEY as Hex | undefined;
  if (!key) throw new Error("VERIFIER_KEY is not set");
  const me = privateKeyToAccount(key).address;
  if (!isCurrent(me)) throw new Error(`${me} is not one of the current verifiers (${current.join(", ")})`);
  if (rest[0] !== undefined && !/^\d+$/.test(rest[0])) throw new Error("deadline must be unix seconds, as the first signer printed it");
  const deadline = rest[0] ? BigInt(rest[0]) : BigInt(Math.floor(Date.now() / 1000) + 86_400);
  const signature = await signVeto(key, { id, deadline }, contract);
  console.log(`${me} signed a veto of ${id} (valid until ${new Date(Number(deadline) * 1000).toISOString()})`);
  console.log(`signature ${signature}`);
  if (!rest[0]) console.log(`second verifier: npm run stake:veto -- sign ${id} ${deadline}`);
} else {
  const [deadlineArg, ...sigs] = rest;
  if (!/^\d+$/.test(deadlineArg ?? "") || sigs.length < 2) {
    console.log(USAGE);
    process.exit(1);
  }
  const v = { id, deadline: BigInt(deadlineArg) };
  if (v.deadline < BigInt(Math.floor(Date.now() / 1000))) throw new Error("the deadline has passed; sign again");
  const bySigner = new Map<bigint, Hex>();
  for (const sig of sigs as Hex[]) {
    const who = await vetoSignerOf(v, sig, contract);
    if (!isCurrent(who)) throw new Error(`a signature comes from ${who}, not a current verifier (different claim id or deadline?)`);
    bySigner.set(BigInt(who), sig);
  }
  if (bySigner.size < 2) throw new Error("need signatures from 2 different verifiers");
  // SellerStakeV2 wants them sorted by signer, ascending.
  const sorted = [...bySigner].sort(([x], [y]) => (x < y ? -1 : 1)).map(([, sig]) => sig);
  const r = await vetoOnChain(id, v.deadline, sorted);
  console.log(`claim ${id} vetoed: https://sepolia.basescan.org/tx/${r.txHash}`);
}
