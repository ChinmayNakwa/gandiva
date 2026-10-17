"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { LandmarkIcon, LockOpenIcon, UndoIcon } from "lucide-react";
import { fetcher } from "@/lib/api";
import { useStake } from "@/lib/hooks";
import { signTypedDataWithWallet, walletErrorMessage, type TypedDataRequest } from "@/lib/wallet";
import type { StakePosition } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TxLink, AddrLink } from "@/components/tx-link";
import { clock } from "@/lib/format";
import { useNow } from "@/lib/clock";

interface StakeEvent {
  id: number;
  ts: string;
  kind: "stake" | "unstake" | "withdraw" | "slash";
  amount: string;
  tx_hash: string | null;
  status: string;
  counterparty: string | null;
  note: string | null;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
  return data as T;
}

/**
 * The seller's bond in SellerStake. Staking and unstaking are signatures only (no gas); the registry relays them.
 * If the seller takes a payment and returns output that breaks its own schema, the bond refunds that buyer.
 */
export function StakePanel({ wallet }: { wallet: string }) {
  const { data: overview } = useStake();
  const { data: pos, mutate } = useSWR<StakePosition & { slashedCount: number; slashed: string }>(`/registry/stake/${wallet}`, fetcher, { refreshInterval: 10000 });
  const { data: events, mutate: mutateEvents } = useSWR<{ events: StakeEvent[] }>(`/registry/stake/events?seller=${wallet}`, fetcher, { refreshInterval: 10000 });
  const [amount, setAmount] = useState("0.05");
  const [busy, setBusy] = useState<string | null>(null);
  const nowMs = useNow(5000);

  if (!overview) return null;
  if (!overview.enabled) {
    return <p className="text-sm text-muted-foreground">Staking is not switched on for this server yet (the SellerStake contract has not been deployed).</p>;
  }

  const now = nowMs / 1000;
  const unlocking = Boolean(pos?.unlockAt);
  const unlocked = unlocking && now >= (pos?.unlockAt ?? 0);
  const refresh = () => Promise.all([mutate(), mutateEvents()]);

  async function run(label: string, fn: () => Promise<{ txHash: string }>) {
    setBusy(label);
    try {
      const r = await fn();
      toast.success(`${label} confirmed`, { description: `tx ${r.txHash.slice(0, 10)}…` });
      await refresh();
    } catch (err) {
      const msg = walletErrorMessage(err);
      if (msg) toast.error(`${label} failed`, { description: msg });
    } finally {
      setBusy(null);
    }
  }

  const stake = () =>
    run("Stake", async () => {
      const typed = await post<TypedDataRequest & { message: Record<string, string> }>("/registry/stake/prepare", { seller: wallet, amount });
      const { signature } = await signTypedDataWithWallet(typed);
      return post("/registry/stake", { ...typed.message, signature });
    });

  const unstake = () =>
    run("Unstake request", async () => {
      const typed = await post<TypedDataRequest & { message: { deadline: string } }>("/registry/stake/unstake/prepare", { seller: wallet });
      const { signature } = await signTypedDataWithWallet(typed);
      return post("/registry/stake/unstake", { seller: wallet, deadline: typed.message.deadline, signature });
    });

  const withdraw = () => run("Withdraw", () => post("/registry/stake/withdraw", { seller: wallet }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Lock USDC behind your listings. Buyers rank staked sellers as more credible, and if you are paid and return output that breaks your own schema, the
        registry refunds that buyer from your bond. Staking is a signature in your wallet: no gas, the registry relays it. Unstaking has a {Math.round((overview.cooldownSeconds ?? 0) / 60)} min
        cooldown so a bond can&apos;t be pulled ahead of a refund.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">your bond</div>
          <div className="mt-1 font-mono text-xl">{pos?.stakedUsdc ?? "…"} USDC</div>
          <div className="text-xs text-muted-foreground">{unlocking ? (unlocked ? "unlocked, ready to withdraw" : `unstaking, unlocks ${new Date((pos?.unlockAt ?? 0) * 1000).toLocaleTimeString()}`) : "locked"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">refunded to buyers</div>
          <div className="mt-1 font-mono text-xl">{pos ? (Number(pos.slashed) / 1e6).toFixed(6) : "…"} USDC</div>
          <div className="text-xs text-muted-foreground">{pos?.slashedCount ?? 0} junk call(s)</div>
        </div>
        <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">contract</div>
          <div className="mt-1 font-mono text-sm">{overview.contract ? <AddrLink address={overview.contract} /> : "…"}</div>
          <div className="text-xs text-muted-foreground">all sellers: {overview.totalStakedUsdc} USDC</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stake-amount">Amount (USDC)</Label>
          <Input id="stake-amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32 font-mono" inputMode="decimal" />
        </div>
        <Button onClick={stake} disabled={Boolean(busy)}>
          <LandmarkIcon /> {busy === "Stake" ? "Sign in your wallet…" : "Stake"}
        </Button>
        <Button variant="outline" onClick={unstake} disabled={Boolean(busy) || !pos || pos.staked === "0" || unlocking}>
          <UndoIcon /> {busy === "Unstake request" ? "Sign in your wallet…" : "Request unstake"}
        </Button>
        <Button variant="outline" onClick={withdraw} disabled={Boolean(busy) || !unlocked}>
          <LockOpenIcon /> Withdraw
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Your wallet needs the USDC itself (Base Sepolia, faucet.circle.com). It does not need ETH.</p>

      {events?.events.length ? (
        <ul className="flex flex-col gap-1 font-mono text-[11px]">
          {events.events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{clock(e.ts)}</span>
              <span className={e.kind === "slash" ? "text-bad" : "text-foreground"}>{e.kind}</span>
              {e.amount !== "0" ? <span>{(Number(e.amount) / 1e6).toFixed(6)} USDC</span> : null}
              {e.kind === "slash" && e.counterparty ? (
                <span className="text-muted-foreground">
                  refunded to <AddrLink address={e.counterparty} />
                </span>
              ) : null}
              <span className="text-muted-foreground">{e.status}</span>
              {e.tx_hash ? <TxLink hash={e.tx_hash} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
