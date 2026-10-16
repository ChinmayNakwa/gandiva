// Junk output test: a standard-SDK reference seller returns 200 with output that breaks its listed schema.
// Expect: recorded as "paid, output rejected", not used, reputation lowered, and the buyer buys from another seller.
import "dotenv/config";
import { api, BASE } from "../lib.js";
import { registerRef, startRefSeller } from "../interop/ref-seller.js";

// Reputation is computed from the ledger per service id, so a fixed id would carry a low score from earlier
// runs and be outranked. A fresh id makes the test repeatable.
const id = `ref-junk-${Date.now().toString(36)}`;
const payTo = process.env.PAYTO_JUNK_FX!;
const ref = await startRefSeller({ port: 4103, price: "$0.0005", payTo, junk: true });
await registerRef(id, ref.url, "500", payTo, "Reference seller that returns junk with status 200");

const rep = async () => (await api(`/registry/services/${id}`)).reputation;
console.log(`${id} reputation before:`, await rep());

const run = await api("/buyer/buy", { category: "data", input: { from: "GBP", to: "INR" }, budget: "0.01" });
for (const p of run.purchases) console.log(`  ${p.service}: ${p.status}, paid ${p.paid}${p.txHash ? ` tx ${p.txHash}` : ""}${p.reason ? ` - ${p.reason}` : ""}`);
console.log("final data used:", JSON.stringify(run.result));
const after = await rep();
console.log(`${id} reputation after:`, after);

const junk = run.purchases.find((p: any) => p.serviceId === id);
const good = run.purchases.find((p: any) => p.serviceId !== id && p.status === "paid");
const pass = junk?.status === "paid_output_rejected" && !!good && run.result?.rate !== "high" && after.score < 1;
ref.close();
await fetch(`${BASE}/registry/services/${id}`, { method: "DELETE" });
console.log(pass ? "\nJUNK OUTPUT TEST PASSED" : `\nJUNK OUTPUT TEST FAILED (if ${id} was not tried first, other data sellers outranked it)`);
process.exit(pass ? 0 : 1);
