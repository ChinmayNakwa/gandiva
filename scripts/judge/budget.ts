// Budget test: a task that needs about 0.02+ USDC with a 0.012 budget, at max_concurrency 1 and then 5.
// Expect spending to never pass 0.012 and the buyer to stop, saying why.
import { runTask, units } from "../lib.js";

const task = process.argv[2] || "From pages 1 to 2 of books.toscrape.com, find the two cheapest 4-star books, give their prices in rupees, and summarise each description in Hindi.";
const budget = process.argv[3] || "0.012";
let pass = true;
for (const conc of [1, 5]) {
  console.log(`\n=== budget ${budget} USDC, max_concurrency ${conc} ===`);
  const run = await runTask(task, budget, conc, true);
  const spent = BigInt(run.spent ?? "0");
  const ok = spent <= BigInt(Math.round(Number(budget) * 1e6));
  pass &&= ok;
  console.log(`state: ${run.state}; spent ${units(spent)} of ${budget} USDC  ${ok ? "PASS" : "FAIL"}`);
  console.log(`why: ${run.log.filter((l: string) => /stopped|budget/.test(l)).slice(-2).join(" | ")}`);
}
console.log(pass ? "\nBUDGET TEST PASSED" : "\nBUDGET TEST FAILED");
process.exit(pass ? 0 : 1);
