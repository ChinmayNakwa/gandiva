import { Hono } from "hono";
import { currentUser } from "../auth/routes.js";
import { EXPLORER_TX, fromUnits, NETWORK, USDC_ADDRESS } from "../config.js";
import { hasActiveRun } from "../buyer/scout.js";
import { AgentWalletError, ensureAgentWallet, getAgentPayer, listWithdrawals, usdcBalance, withdraw } from "./wallet.js";

/** The signed-in user's agent wallet: address, balance, spend cap, withdraw. */
export const agent = new Hono();

agent.get("/", async (c) => {
  const me = currentUser(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  try {
    const address = ensureAgentWallet(me);
    let balance: bigint | null = null;
    let balanceError: string | null = null;
    try {
      balance = await usdcBalance(address);
    } catch (err: any) {
      balanceError = `could not read the balance from the chain: ${String(err?.shortMessage ?? err?.message ?? err).slice(0, 120)}`;
    }
    return c.json({
      user: me,
      address,
      network: NETWORK,
      asset: USDC_ADDRESS,
      balance: balance?.toString() ?? null,
      balanceUsdc: balance === null ? null : fromUnits(balance),
      balanceError,
      spendCap: getAgentPayer(me).cap.status(),
      explorer: `https://sepolia.basescan.org/address/${address}`,
      withdrawals: listWithdrawals(address).slice(0, 10).map((w) => ({ ...w, amount_usdc: fromUnits(w.amount), explorer: w.tx_hash ? EXPLORER_TX + w.tx_hash : null })),
    });
  } catch (err) {
    if (err instanceof AgentWalletError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

agent.post("/withdraw", async (c) => {
  const me = currentUser(c);
  if (!me) return c.json({ error: "sign in with your wallet first" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const raw = String(body?.amount ?? "all");
  if (raw !== "all" && !/^\d+$/.test(raw)) return c.json({ error: 'amount must be "all" or a number of USDC smallest units' }, 400);
  if (hasActiveRun(me)) return c.json({ error: "a run is still paying from your agent wallet; wait for it to finish before withdrawing" }, 409);
  try {
    const w = await withdraw(me, raw === "all" ? "all" : BigInt(raw));
    return c.json({ ...w, amount_usdc: fromUnits(w.amount), explorer: w.tx_hash ? EXPLORER_TX + w.tx_hash : null });
  } catch (err) {
    if (err instanceof AgentWalletError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
