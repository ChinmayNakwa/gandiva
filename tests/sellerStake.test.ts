import { readFileSync } from "node:fs";
import { createEVM, type EVM } from "@ethereumjs/evm";
import { createAddressFromString, createZeroAddress } from "@ethereumjs/util";
import solc from "solc";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeErrorResult, decodeFunctionResult, encodeDeployData, encodeFunctionData, hexToBytes, bytesToHex, parseSignature, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// SellerStake against a mock USDC in an in-process EVM: staking, slashing, the unstake cooldown and the signed unstake.
const MOCK_USDC = `
pragma solidity ^0.8.20;
contract MockUSDC {
  mapping(address => uint256) public balanceOf;
  mapping(bytes32 => bool) public used;
  function mint(address to, uint256 v) external { balanceOf[to] += v; }
  function receiveWithAuthorization(address from, address to, uint256 value, uint256, uint256, bytes32 nonce, uint8, bytes32, bytes32) external {
    require(msg.sender == to, "caller must be the payee");
    require(!used[nonce], "authorization used");
    used[nonce] = true;
    require(balanceOf[from] >= value, "balance");
    balanceOf[from] -= value;
    balanceOf[to] += value;
  }
  function transfer(address to, uint256 v) external returns (bool) {
    require(balanceOf[msg.sender] >= v, "balance");
    balanceOf[msg.sender] -= v;
    balanceOf[to] += v;
    return true;
  }
}`;

function compile(): Record<string, { abi: Abi; bytecode: Hex }> {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "SellerStake.sol": { content: readFileSync("contracts/SellerStake.sol", "utf8") }, "MockUSDC.sol": { content: MOCK_USDC } },
        settings: { evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
      }),
    ),
  );
  const errors = (out.errors ?? []).filter((e: any) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: any) => e.formattedMessage).join("\n"));
  const pick = (file: string, name: string) => ({ abi: out.contracts[file][name].abi, bytecode: `0x${out.contracts[file][name].evm.bytecode.object}` as Hex });
  return { stake: pick("SellerStake.sol", "SellerStake"), usdc: pick("MockUSDC.sol", "MockUSDC") };
}

const artifacts = compile();
const arbiter = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const buyer = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const relayer = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const COOLDOWN = 600n;

let evm: EVM;
let now: bigint;
let usdcAddr: Hex;
let stakeAddr: Hex;

const addr = (a: Hex) => createAddressFromString(a);
const block = () => ({ header: { number: 1n, coinbase: createZeroAddress(), timestamp: now, difficulty: 0n, prevRandao: new Uint8Array(32), gasLimit: 30_000_000n, baseFeePerGas: 0n, getBlobGasPrice: () => undefined } });

async function deploy(a: { abi: Abi; bytecode: Hex }, args: unknown[] = []): Promise<Hex> {
  const r = await evm.runCall({ caller: addr(arbiter.address), data: hexToBytes(encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args })), block: block(), gasLimit: 10_000_000n });
  if (r.execResult.exceptionError) throw new Error(`deploy failed: ${r.execResult.exceptionError.error}`);
  return r.createdAddress!.toString() as Hex;
}

async function call(from: Hex, to: Hex, abi: Abi, functionName: string, args: unknown[] = []) {
  const r = await evm.runCall({ caller: addr(from), to: addr(to), data: hexToBytes(encodeFunctionData({ abi, functionName, args })), block: block(), gasLimit: 5_000_000n });
  const ret = bytesToHex(r.execResult.returnValue);
  if (r.execResult.exceptionError) {
    let reason: string = r.execResult.exceptionError.error;
    try {
      reason = String(decodeErrorResult({ abi, data: ret }).args?.[0] ?? reason);
    } catch {}
    throw new Error(reason);
  }
  return decodeFunctionResult({ abi, functionName, data: ret }) as any;
}

const S = (from: Hex, fn: string, args: unknown[] = []) => call(from, stakeAddr, artifacts.stake.abi, fn, args);
const U = (from: Hex, fn: string, args: unknown[] = []) => call(from, usdcAddr, artifacts.usdc.abi, fn, args);
const nonce = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const stake = (value: bigint, n = 1) => S(relayer.address, "stakeWithAuthorization", [seller.address, value, 0n, now + 3600n, nonce(n), 27, nonce(1), nonce(2)]);

async function unstakeSig(deadline: bigint, sigNonce = 0n, signer = seller) {
  const sig = await signer.signTypedData({
    domain: { name: "Gandiva SellerStake", version: "1", chainId: 1n, verifyingContract: stakeAddr },
    types: { Unstake: [{ name: "seller", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Unstake",
    message: { seller: seller.address, nonce: sigNonce, deadline },
  });
  const { v, r, s, yParity } = parseSignature(sig);
  return [seller.address, deadline, Number(v ?? BigInt(yParity + 27)), r, s] as const;
}

beforeEach(async () => {
  evm = await createEVM();
  now = 1_800_000_000n;
  usdcAddr = await deploy(artifacts.usdc);
  stakeAddr = await deploy(artifacts.stake, [usdcAddr, arbiter.address, COOLDOWN]);
  await U(arbiter.address, "mint", [seller.address, 1_000_000n]);
});

describe("SellerStake", () => {
  it("stakes with the seller's authorisation, relayed by someone else", async () => {
    await stake(50_000n);
    expect(await S(relayer.address, "stakeOf", [seller.address])).toBe(50_000n);
    expect(await S(relayer.address, "totalStaked")).toBe(50_000n);
    expect(await U(relayer.address, "balanceOf", [stakeAddr])).toBe(50_000n);
    expect(await U(relayer.address, "balanceOf", [seller.address])).toBe(950_000n);
  });

  it("cannot reuse a stake authorisation", async () => {
    await stake(10_000n, 7);
    await expect(stake(10_000n, 7)).rejects.toThrow(/authorization used/);
  });

  it("lets only the arbiter slash, refunds the buyer and never takes more than the stake", async () => {
    await stake(5_000n);
    await expect(S(buyer.address, "slash", [seller.address, buyer.address, 1_000n, nonce(9)])).rejects.toThrow(/only arbiter/);
    expect(await S(arbiter.address, "slash", [seller.address, buyer.address, 1_000n, nonce(9)])).toBe(1_000n);
    expect(await U(relayer.address, "balanceOf", [buyer.address])).toBe(1_000n);
    expect(await S(arbiter.address, "slash", [seller.address, buyer.address, 10_000n, nonce(9)])).toBe(4_000n);
    expect(await S(relayer.address, "stakeOf", [seller.address])).toBe(0n);
    await expect(S(arbiter.address, "slash", [seller.address, buyer.address, 1n, nonce(9)])).rejects.toThrow(/nothing to slash/);
  });

  it("keeps the bond locked until the cooldown ends, and slashable meanwhile", async () => {
    await stake(20_000n);
    await S(seller.address, "requestUnstake");
    await expect(S(relayer.address, "withdraw", [seller.address])).rejects.toThrow(/still locked/);
    await S(arbiter.address, "slash", [seller.address, buyer.address, 5_000n, nonce(1)]);
    now += COOLDOWN;
    await S(relayer.address, "withdraw", [seller.address]);
    expect(await U(relayer.address, "balanceOf", [seller.address])).toBe(995_000n);
    expect(await S(relayer.address, "stakeOf", [seller.address])).toBe(0n);
  });

  it("staking again cancels a pending unstake", async () => {
    await stake(20_000n, 1);
    await S(seller.address, "requestUnstake");
    await stake(1_000n, 2);
    now += COOLDOWN;
    await expect(S(relayer.address, "withdraw", [seller.address])).rejects.toThrow(/still locked/);
  });

  it("accepts a gasless unstake signed by the seller, once", async () => {
    await stake(20_000n);
    const args = await unstakeSig(now + 60n);
    await S(relayer.address, "requestUnstakeWithSig", [...args]);
    expect(await S(relayer.address, "unlockAt", [seller.address])).toBe(now + COOLDOWN);
    await expect(S(relayer.address, "requestUnstakeWithSig", [...args])).rejects.toThrow(/bad signature/);
  });

  it("rejects an unstake signed by someone else or after its deadline", async () => {
    await stake(20_000n);
    await expect(S(relayer.address, "requestUnstakeWithSig", [...(await unstakeSig(now + 60n, 0n, buyer))])).rejects.toThrow(/bad signature/);
    await expect(S(relayer.address, "requestUnstakeWithSig", [...(await unstakeSig(now - 1n))])).rejects.toThrow(/signature expired/);
  });
});
