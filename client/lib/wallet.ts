import { createPublicClient, createWalletClient, custom, erc20Abi, type EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const hasWallet = () => typeof window !== "undefined" && Boolean(window.ethereum);

/** Asks the browser wallet (MetaMask or similar) for an account and a signature on the server's sign-in message. */
export async function signInWithWallet(): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask and reload the page.");
  const wallet = createWalletClient({ transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("The wallet did not share an account.");

  const q = new URLSearchParams({ address: account, uri: window.location.origin });
  const challengeRes = await fetch(`/auth/challenge?${q}`);
  const challenge = (await challengeRes.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!challengeRes.ok || !challenge?.message) throw new Error(challenge?.error || `could not start sign-in (${challengeRes.status})`);

  const signature = await wallet.signMessage({ account, message: challenge.message });
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: challenge.message, signature }),
  });
  const data = (await res.json().catch(() => null)) as { address?: string; error?: string } | null;
  if (!res.ok || !data?.address) throw new Error(data?.error || `sign-in failed (${res.status})`);
  return data.address;
}

export async function signOut() {
  await fetch("/auth/logout", { method: "POST" });
}

/** Wallet popups report a refusal as an error with code 4001; that is not worth shouting about. */
export function walletErrorMessage(err: unknown): string | null {
  const e = err as { code?: number; message?: string; shortMessage?: string; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|user denied/i.test(e?.message ?? "")) return null;
  return e?.shortMessage || e?.message || "sign-in failed";
}

/** Sends USDC from the user's own wallet to their agent wallet (a normal token transfer; the user pays the gas in Base Sepolia ETH). */
export async function fundAgentWallet(opts: { agent: string; usdc: string; units: string }, onSent?: (hash: string) => void): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask and reload the page.");
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("The wallet did not share an account.");
  try {
    await wallet.switchChain({ id: baseSepolia.id });
  } catch {
    // Unknown chain in this wallet (error 4902): add Base Sepolia, then switch.
    await wallet.addChain({ chain: baseSepolia });
    await wallet.switchChain({ id: baseSepolia.id });
  }
  const hash = await wallet.writeContract({ account, address: opts.usdc as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [opts.agent as `0x${string}`, BigInt(opts.units)] });
  onSent?.(hash);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: custom(window.ethereum) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transfer failed on chain.");
  return hash;
}
