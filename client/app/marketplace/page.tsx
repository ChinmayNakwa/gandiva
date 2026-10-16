"use client";

import { useState } from "react";
import { servicesUrl } from "@/lib/api";
import { useServices } from "@/lib/hooks";
import {
  MarketFiltersBar,
  type MarketFilters,
} from "@/components/market/market-filters";
import { ServiceCard } from "@/components/market/service-card";
import { PageIntro } from "@/components/page-intro";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketplacePage() {
  const [filters, setFilters] = useState<MarketFilters>({
    category: "",
    maxPrice: "",
    sort: "rank",
  });

  const max = Number(filters.maxPrice);
  const query = {
    category: filters.category,
    sort: filters.sort,
    maxPrice:
      filters.maxPrice && Number.isFinite(max) && max > 0
        ? String(Math.round(max * 1e6))
        : "",
  };
  const { data, error, isLoading } = useServices(query);
  const apiUrl = servicesUrl(query);

  const services = data?.services ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="registry"
        title="Marketplace"
        description="Every listed service, with a reputation computed from the buyer's ledger. Prices are per call in USDC; the buyer ranks sellers by reputation, then price, then latency and fails over when a seller misbehaves."
      >
        <div className="font-mono text-xs text-muted-foreground">
          API:{" "}
          <a
            href={apiUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {apiUrl}
          </a>
        </div>
      </PageIntro>

      <MarketFiltersBar
        value={filters}
        onChange={setFilters}
        count={services.length}
      />

      <section className="mt-6">
        {error ? (
          <p className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error instanceof Error ? error.message : "Failed to load services."}
          </p>
        ) : isLoading && !services.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : services.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s, i) => (
              <ServiceCard key={s.id} service={s} index={i} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No services match these filters.
          </p>
        )}
      </section>
    </div>
  );
}
