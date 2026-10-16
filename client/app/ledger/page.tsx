"use client";

import { useState } from "react";
import { PageIntro } from "@/components/page-intro";
import { Stat } from "@/components/stat";
import { LedgerTable } from "@/components/ledger/ledger-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLedger } from "@/lib/hooks";
import { usdc } from "@/lib/format";

export default function LedgerPage() {
  const [runId, setRunId] = useState("");
  const [applied, setApplied] = useState("");

  const { data, error, isLoading } = useLedger(applied || undefined);
  const entries = data?.entries ?? [];

  const paid = entries.filter((e) => e.status === "paid").length;
  const rejected = entries.filter(
    (e) => e.status === "paid_output_rejected",
  ).length;

  return (
    <>
      <PageIntro
        eyebrow="buyer side"
        title="Ledger"
        description="Every call the buyer attempted: what a seller listed, what it actually asked for at the 402 challenge, and what we paid. Refusals and rejects are recorded even though no money moved."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total paid" value={`${usdc(data?.totalPaid)} USDC`} />
        <Stat label="Entries" value={entries.length} />
        <Stat label="Clean payments" value={paid} hint="status = paid" />
        <Stat label="Output rejected" value={rejected} hint="paid but junk" />
      </div>

      <form
        className="mt-6 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(runId.trim());
        }}
      >
        <Input
          className="w-56 font-mono"
          placeholder="filter by run id"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
        {applied ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setRunId("");
              setApplied("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      <section className="mt-4">
        {error ? (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error instanceof Error ? error.message : "Failed to load ledger."}
          </p>
        ) : (
          <LedgerTable entries={isLoading && !entries.length ? [] : entries} />
        )}
      </section>
    </>
  );
}
