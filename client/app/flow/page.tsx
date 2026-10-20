"use client";

import { PageIntro } from "@/components/page-intro";
import { MoneyFlow } from "@/components/flow/money-flow";
import { useInfo, useLedger } from "@/lib/hooks";

export default function FlowPage() {
  const { data, error, isLoading } = useLedger();
  const { data: info } = useInfo();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="who paid whom"
        title="Money flow"
        description="Every wallet that moved testnet USDC, and every payment between them: buyers on the left, chains that both earn and hire in the middle, sellers on the right. Each line is real on-chain transfers (latest 500 ledger rows)."
      />

      {/* Holds the footer below the fold while the graph loads (no layout shift). */}
      <section className="min-h-[60svh]">
        {error ? (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error instanceof Error ? error.message : "Failed to load the ledger."}
          </p>
        ) : isLoading && !data ? null : (
          <MoneyFlow entries={data?.entries ?? []} demoBuyer={info?.buyer} />
        )}
      </section>
    </div>
  );
}
