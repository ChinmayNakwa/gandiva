"use client";

import { useState } from "react";
import { PageIntro } from "@/components/page-intro";
import { Stat } from "@/components/stat";
import { LedgerTable } from "@/components/ledger/ledger-table";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLedger } from "@/lib/hooks";
import { usdc } from "@/lib/format";
import type { LedgerStatus } from "@/lib/types";

const ALL = "all";

export default function LedgerPage() {
  const [runId, setRunId] = useState(ALL);

  const { data: all } = useLedger();
  const { data, error, isLoading } = useLedger(runId === ALL ? undefined : runId);
  const entries = data?.entries ?? [];
  const runIds = [
    ...new Set((all?.entries ?? []).map((e) => e.run_id).filter((r): r is string => !!r)),
  ];

  const count = (s: LedgerStatus) => entries.filter((e) => e.status === s).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="buyer side"
        title="Ledger"
        description="Every call the buyer attempted: what a seller listed, what it actually asked for at the 402 challenge, and what we paid. Refusals and rejects are recorded even though no money moved."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          className="col-span-2 sm:col-span-1"
          label="Total paid"
          value={`${usdc(data?.totalPaid)} USDC`}
          hint={`${data?.totalPaid ?? "0"} units`}
        />
        <Stat
          label="Unconfirmed"
          value={count("unconfirmed")}
          hint="settling, checked on-chain"
        />
        <Stat label="Paid" value={count("paid")} hint="clean payments" />
        <Stat
          label="Output rejected"
          value={count("paid_output_rejected")}
          hint="paid, but junk"
        />
        <Stat label="Refused" value={count("refused")} hint="never signed" />
        <Stat
          className="col-span-2 sm:col-span-1"
          label="Failed"
          value={count("failed_not_charged")}
          hint="not charged"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="l-run" className="text-xs text-muted-foreground">
            Run
          </Label>
          <Select value={runId} onValueChange={setRunId}>
            <SelectTrigger id="l-run" className="w-56 font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>all runs</SelectItem>
              {runIds.map((r) => (
                <SelectItem key={r} value={r} className="font-mono">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="pb-2 text-xs text-muted-foreground">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · refreshes every 4 s
        </span>
      </div>

      {/* Holds the footer below the fold while the list loads (no layout shift). */}
      <section className="mt-4 min-h-[60svh]">
        {error ? (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error instanceof Error ? error.message : "Failed to load ledger."}
          </p>
        ) : (
          <LedgerTable entries={isLoading && !entries.length ? [] : entries} loaded={!isLoading} />
        )}
      </section>
    </div>
  );
}
