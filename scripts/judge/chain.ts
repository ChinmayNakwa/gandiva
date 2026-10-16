// Agent-chain test (SPENDS REAL TESTNET USDC): the shared demo wallet pays travel-brief 0.020 USDC; travel-brief then hires and
// pays the weather, FX and Hindi sellers from its own wallet (up to 0.013). Checks that every hop shows up in a ledger with its
// own tx, that what the agent says it paid equals what its ledger says, and that it never spent more than its sub-budget.
// The travel-brief wallet needs some USDC float first (npm run wallets:new prints its address).
// Afterwards: npm run reconcile, and npm run reconcile -- <travel-brief address>
import { api, units } from "../lib.js";

const SUB_BUDGET = 13000n;
const info = await api("/api/info");
const brief = info.sellers.find((s: any) => s.id === "travel-brief");
if (!brief) {
  console.log("travel-brief is not running on this server (is TRAVEL_BRIEF_KEY set? run npm run wallets:new and restart)");
  process.exit(1);
}
const writer = String(brief.payTo).toLowerCase();
console.log(`travel-brief wallet ${writer}`);

const lastId = Math.max(0, ...(await api(`/registry/ledger?buyer=${writer}`)).entries.map((e: any) => e.id));
const r = await api("/buyer/call", { serviceId: "travel-brief", input: { city: "Tokyo", amount: 100, from: "GBP", hindi: true }, budget: "0.02", timeoutMs: 90_000 });
console.log(`\nbuyer -> travel-brief: ${r.status}, paid ${units(r.paid)} USDC${r.txHash ? `, tx ${r.txHash}` : ""}${r.reason ? `\n  ${r.reason}` : ""}`);

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) problems.push(msg);
};

check(r.status === "paid", "the buyer's call was paid and its output accepted");
if (r.status === "paid") {
  const data = r.data;
  const hired: any[] = data.hired ?? [];
  const cost = BigInt(data.cost_units);
  console.log(`\n  brief: ${data.brief}\n  hindi: ${data.brief_hi}\n`);
  check(r.paid === "20000", "the buyer paid exactly the listed 0.020");
  check(hired.length >= 3 && hired.every((h) => h.tx_hash), `travel-brief paid ${hired.length} sellers, each with its own tx hash`);
  check(new Set(hired.map((h) => h.tx_hash)).size === hired.length && !hired.some((h) => h.tx_hash === r.txHash), "every hop is a different on-chain transfer, none is the buyer's payment");
  check(cost <= SUB_BUDGET, `its spend ${units(cost)} stayed within its ${units(SUB_BUDGET)} sub-budget (margin ${units(BigInt(r.paid) - cost)})`);
  console.log(`  hired: ${hired.map((h) => `${h.service} ${units(h.paid)}`).join(", ")}`);

  const rows = (await api(`/registry/ledger?buyer=${writer}`)).entries.filter((e: any) => e.id > lastId);
  const chain = rows.filter((e: any) => String(e.run_id ?? "").startsWith("chain-") && (e.status === "paid" || e.status === "paid_output_rejected"));
  const ledgerTotal = chain.reduce((a: bigint, e: any) => a + BigInt(e.paid), 0n);
  check(ledgerTotal === cost, `the agent's own ledger (${units(ledgerTotal)}) equals what it reports having paid (${units(cost)})`);
  check(chain.every((e: any) => hired.some((h) => h.tx_hash === e.tx_hash)), "every paid row in its ledger is listed in the answer, with the same tx");
}

console.log(problems.length ? `\nCHAIN TEST FAILED (${problems.length})` : "\nCHAIN TEST PASSED");
process.exit(problems.length ? 1 : 0);
