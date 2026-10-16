// Paid MCP tools demo: an off-the-shelf MCP client with x402 payments (@x402/mcp) talks to Gandiva's /mcp.
// Usage: npm run mcp:demo [-- --free]      (--free: list tools and call the free ones only; nothing is paid)
// Without --free it buys one city_info call (0.002 testnet USDC) from the shared demo buyer wallet.
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createx402MCPClient } from "@x402/mcp";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { config, fromUnits, NETWORK } from "../src/config.js";
import { BASE } from "./lib.js";

const free = process.argv.includes("--free");
if (!config.buyerPrivateKey) throw new Error("BUYER_PRIVATE_KEY is not set");
const account = privateKeyToAccount(config.buyerPrivateKey);

const listed = new Map<string, { price: bigint; payTo: string }>();
const client = createx402MCPClient({
  name: "gandiva-mcp-demo",
  version: "1.0.0",
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
  // Same rule as Scout: pay only what the registry lists, to the listed payTo, never more.
  policies: [
    (_v, reqs) =>
      reqs.filter((r) => {
        const l = [...listed.values()].find((x) => x.payTo.toLowerCase() === r.payTo.toLowerCase());
        return l !== undefined && BigInt(r.amount) <= l.price;
      }),
  ],
  onPaymentRequested: ({ toolName, paymentRequired }) => {
    const a = paymentRequired.accepts[0];
    console.log(`  402 for ${toolName}: ${fromUnits(a.amount)} USDC to ${a.payTo}; paying from ${account.address}`);
    return true;
  },
});

await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
const { tools } = await client.listTools();
console.log(`MCP server ${BASE}/mcp: ${tools.length} tools`);
for (const t of tools) console.log(`  - ${t.name}: ${(t.description ?? "").slice(0, 90)}`);

const first = (r: { content: any[] }) => JSON.parse(r.content[0].text);
const services = first(await client.callTool("list_services", {})).services as any[];
for (const s of services) listed.set(s.id, { price: BigInt(Math.round(Number(s.price_usdc) * 1e6)), payTo: s.payTo });
console.log(`\nlist_services (free): ${services.length} services, top: ${services.slice(0, 3).map((s) => `${s.id} ${s.price_usdc}`).join(", ")}`);

if (free) {
  console.log("\n--free: no paid call made.");
} else {
  console.log("\ncity_info (paid):");
  const r = await client.callTool("city_info", { name: "Tokyo" });
  if (r.isError) {
    console.log(`  error, not charged: ${r.content[0]?.text}`);
    process.exitCode = 1;
  } else {
    const city = first(r);
    console.log(`  ${city.city}, ${city.country}: ${city.temperature_c}°C, ${city.conditions}; currency ${city.currency}`);
    console.log(`  paid: ${r.paymentMade}, tx ${r.paymentResponse?.transaction ?? "?"}  https://sepolia.basescan.org/tx/${r.paymentResponse?.transaction ?? ""}`);
  }
}
await client.close();
