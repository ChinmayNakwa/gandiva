// An outside SellerStakeV2 verifier, one of the three. It re-checks every open claim itself (the evidence's hash, the
// payment and the receipt signer on chain, the seller's receipt, the schema) before it signs, and trusts the server only
// for the list of claims. It also signs a veto when a seller's rebuttal holds up.
// Usage: npm run verifier             (a pass every 60 s)
//        npm run verifier -- --once   (one pass, for cron / GitHub Actions; exits 1 if a request failed)
// Env: VERIFIER_KEY, STAKE_CONTRACT, GANDIVA_URL (default http://localhost:4021), BASE_SEPOLIA_RPC (optional)
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "../src/config.js";
import { checkClaim, checkRebuttal, claimIdOf, rpcChainView, signClaim, signVeto, type ChainView, type ClaimMessage } from "../src/stake/verify.js";
import { BASE } from "./lib.js";

const FIELDS = ["seller", "buyer", "amount", "paymentNonce", "evidence", "kind", "deadline"] as const;
/** The server stores amounts and deadlines as strings; compare field by field so only the content counts. */
const sameMessage = (mine: ClaimMessage, theirs: Record<string, unknown>) => FIELDS.every((f) => String(mine[f]).toLowerCase() === String(theirs[f]).toLowerCase());

export async function runOnce(o: { url: string; key: Hex; contract: Hex; chain: ChainView; now?: bigint; log?: (line: string) => void }) {
  const log = o.log ?? ((line: string) => console.log(`[verifier] ${line}`));
  const me = privateKeyToAccount(o.key).address.toLowerCase();
  const signedBy = (list: string[]) => list.some((a) => a.toLowerCase() === me);
  const out = { signed: 0, vetoed: 0, failed: 0 };

  const res = await fetch(`${o.url}/registry/stake/claims?state=active`);
  if (!res.ok) throw new Error(`claims list -> ${res.status}`);
  const { claims } = (await res.json()) as { claims: any[] };

  const bundleOf = async (hash: string) => {
    const r = await fetch(`${o.url}/registry/stake/evidence/${hash}`);
    if (!r.ok) throw new Error(`evidence ${hash} -> ${r.status}`);
    return r.json();
  };
  const post = async (id: number, type: "claim" | "veto", signature: Hex) => {
    const r = await fetch(`${o.url}/registry/stake/claims/${id}/signature`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, signature }) });
    if (r.ok) return true;
    log(`claim ${id}: ${type} signature refused (${r.status}) ${await r.text()}`);
    if (r.status !== 409) out.failed++; // 409: the claim moved on since the list was read
    return false;
  };

  for (const c of claims) {
    try {
      if (c.state === "open" && c.message && !signedBy(c.signatures)) {
        const v = await checkClaim(c.evidence, await bundleOf(c.evidence), o.chain, o.now);
        if (!v.ok) log(`claim ${c.id}: not signing (${v.code}: ${v.reason})`);
        else if (!sameMessage(v.message, c.message)) log(`claim ${c.id}: not signing, the server's message differs from what the evidence shows`);
        else if (await post(c.id, "claim", await signClaim(o.key, v.message, o.contract))) (out.signed++, log(`claim ${c.id}: signed (kind ${v.kind}, ${v.message.amount} units)`));
      } else if (c.state === "proposed" && c.rebuttal && c.vetoDeadline && !signedBy(c.vetoSignatures)) {
        const b = await bundleOf(c.evidence);
        const r = await checkRebuttal(b, c.rebuttal, o.chain);
        if (!r.ok) log(`claim ${c.id}: rebuttal does not hold up (${r.reason})`);
        else if (await post(c.id, "veto", await signVeto(o.key, { id: claimIdOf(b.payment.payTo, b.payment.payer, b.payment.nonce), deadline: BigInt(c.vetoDeadline) }, o.contract))) {
          out.vetoed++;
          log(`claim ${c.id}: veto signed`);
        }
      }
    } catch (err: any) {
      out.failed++;
      log(`claim ${c.id}: ${err?.message ?? err}`);
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.VERIFIER_KEY as Hex | undefined;
  const contract = config.stake.contract;
  if (!key || !contract) {
    console.error("Set VERIFIER_KEY and STAKE_CONTRACT (see .env.example).");
    process.exit(1);
  }
  const pub = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
  const me = privateKeyToAccount(key).address;
  const abi = parseAbi(["function verifiers(uint256) view returns (address)"]);
  const set = await Promise.all([0n, 1n, 2n].map((i) => pub.readContract({ address: contract, abi, functionName: "verifiers", args: [i] })));
  if (!set.some((a) => a.toLowerCase() === me.toLowerCase())) console.warn(`[verifier] ${me} is not one of the contract's verifiers (${set.join(", ")}); the server will refuse its signatures`);

  const chain = rpcChainView(pub as any, contract);
  const pass = async () => {
    const r = await runOnce({ url: BASE, key, contract, chain });
    console.log(`[verifier] pass done: signed ${r.signed}, vetoed ${r.vetoed}, failed ${r.failed}`);
    return r;
  };
  if (process.argv.includes("--once")) process.exit((await pass()).failed ? 1 : 0);
  console.log(`[verifier] ${me} checking ${BASE} every 60 s`);
  for (;;) {
    await pass().catch((err) => console.warn(`[verifier] ${err?.message ?? err}`));
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
