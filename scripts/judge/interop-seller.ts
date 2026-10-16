// Interop: our buyer pays an unmodified @x402/express seller (started in-process and registered in our registry).
import "dotenv/config";
import { api, BASE } from "../lib.js";
import { registerRef, startRefSeller } from "../interop/ref-seller.js";

const payTo = process.env.PAYTO_ATTACKER!;
const ref = await startRefSeller({ port: 4104, price: "$0.001", payTo });
await registerRef("ref-fx", ref.url, "1000", payTo, "Reference seller using unmodified @x402/express");
const r = await api("/buyer/call", { serviceId: "ref-fx", input: { from: "GBP", to: "INR" }, budget: "0.01" });
console.log(`our buyer -> standard @x402/express seller: ${r.status}, paid ${r.paid}${r.txHash ? `, tx ${r.txHash}` : ""}${r.reason ? ` - ${r.reason}` : ""}`);
if (r.explorer) console.log(`explorer: ${r.explorer}`);
ref.close();
await fetch(`${BASE}/registry/services/ref-fx`, { method: "DELETE" });
const pass = r.status === "paid" && !!r.txHash;
console.log(pass ? "INTEROP (OUR BUYER -> STANDARD SELLER) PASSED" : "INTEROP (OUR BUYER -> STANDARD SELLER) FAILED");
process.exit(pass ? 0 : 1);
