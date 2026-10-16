// Throwaway x402 seller for trying the Sell tab: asks for a 402 that pays YOUR wallet, and registers nothing.
// Usage: npm run dev:seller -- <your wallet address> [port] [priceUSD]
// Then in the Sell tab list http://localhost:<port>/rate at the same price; the listing should show "402 matches".
import { isAddress } from "viem";
import { fxSchemas, startRefSeller } from "../interop/ref-seller.js";

const [payTo, port = "4500", price = "0.001"] = process.argv.slice(2);
if (!payTo || !isAddress(payTo)) {
  console.error("usage: npm run dev:seller -- <your wallet address 0x...> [port] [priceUSD]");
  process.exit(1);
}

const seller = await startRefSeller({ port: Number(port), price: `$${price.replace("$", "")}`, payTo });
const units = Math.round(Number(price.replace("$", "")) * 1e6);
console.log(`test seller running: ${seller.url}`);
console.log(`it asks ${price} USDC and pays ${payTo}\n`);
console.log("Fill the Sell tab with:");
console.log(`  Name       my-matching-seller`);
console.log(`  Category   data     Method GET     Price ${price}  (${units} units)`);
console.log(`  Endpoint   ${seller.url}`);
console.log(`  Input      ${JSON.stringify(fxSchemas.inputSchema)}`);
console.log(`  Output     ${JSON.stringify(fxSchemas.outputSchema)}`);
console.log("\nCtrl+C stops it.");
