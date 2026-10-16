// Usage: npm run task -- "<task in plain language>" [budgetUSDC] [maxConcurrency] [--dry] [--legacy]
//   --dry     plan and quote only; nothing is paid
//   --legacy  use only the built-in books pipeline (no LLM planning)
import { runTask } from "./lib.js";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [task, budget = "0.05", conc = "3"] = args.filter((a) => !a.startsWith("--"));
if (!task) {
  console.log('Usage: npm run task -- "From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi." 0.05 3 [--dry] [--legacy]');
  process.exit(1);
}
const run = await runTask(task, budget, Number(conc), false, { dryRun: flags.includes("--dry"), mode: flags.includes("--legacy") ? "legacy" : undefined });
console.log("\n" + run.explanation);
if (run.quote) console.log(`\nQuote: about ${(Number(run.quote.total) / 1e6).toFixed(6)} USDC (${run.quote.lines.length} paid call(s))\n${run.quote.note}`);
console.log("\nResult:\n" + JSON.stringify(run.result, null, 2));
