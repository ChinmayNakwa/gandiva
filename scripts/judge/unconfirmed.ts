// Unconfirmed payment test (live, spends 0.001 USDC of testnet money in the first scenario).
//
// A) The seller verifies our payment, then answers too slowly. Our buyer times out AFTER signing, so it cannot know whether the
//    seller settles. Expect: ledger row "unconfirmed" (not "failed, not charged"); the seller then settles on-chain; the
//    background resolver turns the row into "paid" with the real tx hash; `npm run reconcile` then matches the chain.
// B) (--expire) Same, but the seller fails after the delay and never settles. Expect: "unconfirmed", then, once the
//    authorisation's validBefore passes, "failed, not charged" with nothing paid. Takes about 5 minutes.
import "dotenv/config";
import { api, removeListing } from "../lib.js";
import { registerRef, startRefSeller } from "../interop/ref-seller.js";

const payTo = process.env.PAYTO_ATTACKER!;
const expire = process.argv.includes("--expire");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rowOf = async (id: number) => (await api("/registry/ledger")).entries.find((e: any) => e.id === id);

async function waitFor(id: number, done: (row: any) => boolean, maxMs: number) {
  const until = Date.now() + maxMs;
  let row = await rowOf(id);
  while (!done(row) && Date.now() < until) {
    await sleep(5_000);
    row = await rowOf(id);
    process.stdout.write(`  ... ledger #${id} is ${row?.status}\n`);
  }
  return row;
}

async function scenario(name: string, opts: { failAfterDelay: boolean }) {
  const id = `ref-slow-${Date.now().toString(36)}`;
  const ref = await startRefSeller({ port: opts.failAfterDelay ? 4106 : 4105, price: "$0.001", payTo, delayMs: 9_000, failAfterDelay: opts.failAfterDelay });
  await registerRef(id, ref.url, "1000", payTo, `Reference seller that answers after 9 s (${name})`);
  console.log(`\n${name}: buyer timeout 3 s, seller answers after 9 s`);
  const r = await api("/buyer/call", { serviceId: id, input: { from: "GBP", to: "INR" }, budget: "0.01", timeoutMs: 3_000 });
  console.log(`  buyer result: ${r.status}, paid ${r.paid} - ${r.reason}`);
  const first = await rowOf(r.ledgerId);
  const startedOk = r.status === "unconfirmed" && r.paid === "0" && first?.status === "unconfirmed";
  console.log(`  ledger #${r.ledgerId} right after the timeout: ${first?.status}  ${startedOk ? "PASS" : "FAIL (expected unconfirmed)"}`);
  if (!startedOk) {
    ref.close();
    await removeListing(id);
    return false;
  }
  const final = await waitFor(r.ledgerId, (row) => row?.status !== "unconfirmed", opts.failAfterDelay ? 8 * 60_000 : 2 * 60_000);
  ref.close();
  await removeListing(id);
  if (opts.failAfterDelay) {
    const ok = final?.status === "failed_not_charged" && final.paid === "0";
    console.log(`  resolved to: ${final?.status}, paid ${final?.paid}  ${ok ? "PASS" : "FAIL"}`);
    return ok;
  }
  const ok = final?.status === "paid" && final.paid === "1000" && !!final.tx_hash;
  console.log(`  resolved to: ${final?.status}, paid ${final?.paid}${final?.tx_hash ? `, tx ${final.tx_hash}` : ""}  ${ok ? "PASS" : "FAIL"}`);
  if (final?.explorer) console.log(`  explorer: ${final.explorer}`);
  return ok;
}

let pass = await scenario("A) seller settles late", { failAfterDelay: false });
if (expire) pass = (await scenario("B) seller never settles", { failAfterDelay: true })) && pass;
console.log(pass ? "\nUNCONFIRMED PAYMENT TEST PASSED. Now run: npm run reconcile" : "\nUNCONFIRMED PAYMENT TEST FAILED");
process.exit(pass ? 0 : 1);
