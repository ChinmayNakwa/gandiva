// Usage: npm run task -- "<task in plain language>" [budgetUSDC] [maxConcurrency]
import { runTask } from "./lib.js";

const [task, budget = "0.05", conc = "3"] = process.argv.slice(2);
if (!task) {
  console.log('Usage: npm run task -- "From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi." 0.05 3');
  process.exit(1);
}
const run = await runTask(task, budget, Number(conc));
console.log("\n" + run.explanation);
console.log("\nResult:\n" + JSON.stringify(run.result, null, 2));
