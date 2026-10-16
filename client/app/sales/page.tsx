"use client";

import { PageIntro } from "@/components/page-intro";
import { Stat } from "@/components/stat";
import { SalesTable } from "@/components/sales/sales-table";
import { useSales } from "@/lib/hooks";
import { usdc } from "@/lib/format";

export default function SalesPage() {
  const { data, error, isLoading } = useSales();
  const sales = data?.sales ?? [];
  const paid = sales.filter((s) => s.status === "paid");

  const totalUnits = paid.reduce((acc, s) => acc + Number(s.amount || "0"), 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="seller side"
        title="Sales"
        description="Seller-side view: every payment our sellers received or refused, from any x402 client (including standard SDK clients). Sellers settle only after delivering valid output, so failed work is never charged."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Settled volume" value={`${usdc(totalUnits)} USDC`} />
        <Stat label="Settled" value={paid.length} hint="paid receipts" />
        <Stat
          label="Not settled"
          value={sales.length - paid.length}
          hint="failed, refused or replayed"
        />
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
    </div>
  );
}
