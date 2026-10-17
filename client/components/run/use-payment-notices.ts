"use client";

import { createElement, useEffect, useRef } from "react";
import { toast } from "sonner";
import { TxLink } from "@/components/tx-link";
import { statusLabel, usdc } from "@/lib/format";
import { playFailed, playSettled } from "@/lib/sound";
import type { Run } from "@/lib/types";

/**
 * A toast (and, if switched on, a sound) for each payment the run records,
 * and one when the run ends. Receipts already present when the run is first
 * seen stay quiet.
 */
export function usePaymentNotices(run: Run | undefined) {
  const seen = useRef<{ id: string; count: number; state: string } | null>(null);

  useEffect(() => {
    if (!run) return;
    const last = seen.current;
    seen.current = { id: run.id, count: run.purchases.length, state: run.state };
    if (!last || last.id !== run.id) return;

    for (const p of run.purchases.slice(last.count)) {
      if (p.status === "paid") {
        playSettled();
        toast.success(`Paid ${usdc(p.paid)} USDC to ${p.service}`, {
          description: createElement(TxLink, { hash: p.txHash }),
        });
      } else if (p.status === "paid_output_rejected" || p.status === "unconfirmed") {
        playFailed();
        toast.warning(`${p.service}: ${statusLabel(p.status)}`, { description: p.reason });
      } else {
        playFailed();
        toast.error(`${p.service}: ${statusLabel(p.status)}`, {
          description: p.reason ? `${p.reason}. Nothing was charged.` : "Nothing was charged.",
        });
      }
    }

    if (last.state === "running" && run.state !== "running") {
      const spent = `${usdc(run.spent)} USDC spent on ${run.purchases.length} call${run.purchases.length === 1 ? "" : "s"}`;
      if (run.state === "completed") toast.success("Run complete", { description: spent });
      else if (run.state === "failed") toast.error("Run failed", { description: spent });
      else toast.warning(`Run ended: ${run.state.replace(/_/g, " ")}`, { description: spent });
    }
  }, [run]);
}
