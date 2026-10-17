// Compiles contracts/SellerStake.sol into contracts/SellerStake.json (ABI + bytecode), which the server and deploy script use.
import { readFileSync, writeFileSync } from "node:fs";
import solc from "solc";

const source = readFileSync("contracts/SellerStake.sol", "utf8");
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "SellerStake.sol": { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
    }),
  ),
);
const errors = (out.errors ?? []).filter((e: any) => e.severity === "error");
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts["SellerStake.sol"].SellerStake;
writeFileSync("contracts/SellerStake.json", JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + "\n");
console.log(`compiled with solc ${solc.version()}: ${c.evm.bytecode.object.length / 2} bytes`);
