// Compiles contracts/SellerStakeV2.sol into contracts/SellerStakeV2.json (ABI + bytecode), which the server and deploy script use.
// SellerStake.json (V1) is frozen as deployed; it is only needed to withdraw the V1 bonds.
import { readFileSync, writeFileSync } from "node:fs";
import solc from "solc";

const name = "SellerStakeV2";
const source = readFileSync(`contracts/${name}.sol`, "utf8");
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { [`${name}.sol`]: { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
    }),
  ),
);
const errors = (out.errors ?? []).filter((e: any) => e.severity === "error");
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if (errors.length) process.exit(1);
const c = out.contracts[`${name}.sol`][name];
writeFileSync(`contracts/${name}.json`, JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + "\n");
console.log(`compiled with solc ${solc.version()}: ${c.evm.bytecode.object.length / 2} bytes`);
