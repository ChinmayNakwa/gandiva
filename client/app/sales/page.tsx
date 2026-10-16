"use client";

import { PageIntro } from "@/components/page-intro";
import { Stat } from "@/components/stat";
import { SalesTable } from "@/components/sales/sales-table";
import { useSales } from "@/lib/hooks";
import { usdc } from "@/lib/format";

export default function SalesPage() {
  const { data, error, isLoading } = useSales();
  const sales = data?.sales ?? [];

  const totalUnits = sales.reduce(
    (acc, s) => acc + Number(s.amount || "0"),
    0,
  );

  return (
    <>
      <PageIntro
        eyebrow="seller side"
        title="Sales"
        description="The other half of every payment: each seller's settled receipts, whether the acquirer/facilitator confirmed the transfer, and how long the call took."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Settled volume" value={`${usdc(totalUnits)} USDC`} />
        <Stat label="Receipts" value={sales.length} />
        <Stat
          label="Sellers"
          value={new Set(sales.map((s) => s.seller)).size}
        />
      </div>

      <section className="mt-6">
        {error ? (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error instanceof Error ? error.message : "Failed to load sales."}
          </p>
        ) : (
          <SalesTable sales={isLoading && !sales.length ? [] : sales} />
        )}
      </section>
    </>
  );
}
