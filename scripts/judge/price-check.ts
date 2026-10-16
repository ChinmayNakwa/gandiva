// Price check test with standard-SDK reference sellers:
//  A) listed at 0.001 USDC but its 402 asks 0.010
//  B) listed with payTo X but its 402 names payTo Y
// Expect our buyer to refuse both and pay nothing.
import "dotenv/config";
import { api, removeListing } from "../lib.js";
import { registerRef, startRefSeller } from "../interop/ref-seller.js";

const listedPayTo = process.env.PAYTO_FX_RATES!;
const otherPayTo = process.env.PAYTO_ATTACKER!;

const a = await startRefSeller({ port: 4101, price: "$0.01", payTo: listedPayTo });
await registerRef("ref-overpriced", a.url, "1000", listedPayTo, "Reference seller: listed 0.001, 402 asks 0.010");
const b = await startRefSeller({ port: 4102, price: "$0.001", payTo: otherPayTo });
await registerRef("ref-wrong-payto", b.url, "1000", listedPayTo, "Reference seller: 402 names a different payTo");

let pass = true;
for (const id of ["ref-overpriced", "ref-wrong-payto"]) {
  const r = await api("/buyer/call", { serviceId: id, input: { from: "GBP", to: "INR" }, budget: "0.05" });
  const ok = r.status === "refused" && r.paid === "0";
  pass &&= ok;
  console.log(`${id}: ${r.status}, paid ${r.paid} - ${r.reason}  ${ok ? "PASS" : "FAIL"}`);
}
a.close();
b.close();
for (const id of ["ref-overpriced", "ref-wrong-payto"]) await removeListing(id);
console.log(pass ? "\nPRICE CHECK TEST PASSED" : "\nPRICE CHECK TEST FAILED");
process.exit(pass ? 0 : 1);
