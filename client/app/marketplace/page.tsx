"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { CloudOffIcon, RotateCwIcon, SearchXIcon } from "lucide-react";
import { servicesUrl } from "@/lib/api";
import { useServices } from "@/lib/hooks";
import { getLenis } from "@/lib/scroll";
import {
  DEFAULT_FILTERS,
  MarketFiltersBar,
  type MarketFilters,
} from "@/components/market/market-filters";
import { ServiceCard } from "@/components/market/service-card";
import { ServiceSearch } from "@/components/market/service-search";
import { AgentWalletCard } from "@/components/agent/agent-wallet-card";
import { PageIntro } from "@/components/page-intro";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Scroll a card to the middle of the screen, focus it and wash it briefly. */
function revealCard(el: HTMLElement) {
  const y = el.getBoundingClientRect().top + scrollY - Math.max((innerHeight - el.offsetHeight) / 2, 96);
  const lenis = getLenis();
  if (lenis) {
    lenis.resize();
    lenis.scrollTo(y, { duration: 0.9 });
  } else {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  }
  el.focus({ preventScroll: true });
  const wash = el.querySelector<HTMLElement>("[data-flash]");
  if (wash) {
    wash.classList.remove("animate-flash-in");
    void wash.offsetWidth; // restart the animation
    wash.classList.add("animate-flash-in");
  }
}

function filterLabels(f: MarketFilters) {
  const out: string[] = [];
  if (f.category) out.push(`category ${f.category}`);
  if (f.maxPrice) out.push(`max ${f.maxPrice} USDC`);
  return out;
}

export default function MarketplacePage() {
  const [filters, setFilters] = useState<MarketFilters>(DEFAULT_FILTERS);
  const [searching, setSearching] = useState(false);
  /** A search pick whose card is hidden by the filters; shown once they reset. */
  const pending = useRef<string | null>(null);

  const max = Number(filters.maxPrice);
  const query = {
    category: filters.category,
    sort: filters.sort,
    maxPrice:
      filters.maxPrice && Number.isFinite(max) && max > 0
        ? String(Math.round(max * 1e6))
        : "",
  };
  const { data, error, isLoading, isValidating, mutate } = useServices(query);
  const all = useServices({ sort: "rank" });
  const apiUrl = servicesUrl(query);

  const services = data?.services ?? [];

  // ⌘K / Ctrl+K anywhere, or "/" when not typing, opens the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing =
        e.target instanceof Element &&
        e.target.closest("input, textarea, select, [contenteditable]") !== null;
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearching(true);
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // A pick that needed the filters cleared lands once its card is rendered.
  useEffect(() => {
    const id = pending.current;
    if (!id) return;
    const el = document.getElementById(`svc-${id}`);
    if (!el) return;
    pending.current = null;
    requestAnimationFrame(() => revealCard(el));
  }, [data]);

  function onPick(id: string) {
    const el = document.getElementById(`svc-${id}`);
    if (el) return revealCard(el);
    pending.current = id;
    setFilters({ ...DEFAULT_FILTERS, sort: filters.sort });
  }

  const active = filterLabels(filters);

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

      <div className="mb-6">
        <AgentWalletCard />
      </div>

      <MarketFiltersBar
        value={filters}
        onChange={setFilters}
        onSearch={() => setSearching(true)}
        count={services.length}
      />

      <ServiceSearch
        open={searching}
        onOpenChange={setSearching}
        services={all.data?.services ?? services}
        onPick={(s) => onPick(s.id)}
      />

      <section className="mt-6">
        {error && !services.length ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 px-6 py-14 text-center">
            <CloudOffIcon className="size-8 text-bad" />
            <h2 className="font-display text-2xl">Can&apos;t reach the registry</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              The list of services comes from the API server. Check it is running,
              then try again.
            </p>
            <p className="font-mono text-xs text-bad">
              {error instanceof Error ? error.message : "Failed to load services."}
            </p>
            <Button variant="outline" size="sm" onClick={() => mutate()} disabled={isValidating}>
              <RotateCwIcon className={isValidating ? "animate-spin" : undefined} /> Try again
            </Button>
          </div>
        ) : isLoading && !services.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : services.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {services.map((s, i) => (
                <ServiceCard key={s.id} service={s} index={i} />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <SearchXIcon className="size-8 text-muted-foreground" />
            <h2 className="font-display text-2xl">No services match</h2>
            {active.length ? (
              <div className="flex flex-wrap justify-center gap-2">
                {active.map((label) => (
                  <span key={label} className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing is listed yet. Sellers can add one on the Sell tab.</p>
            )}
            {active.length ? (
              <Button variant="outline" size="sm" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                Clear filters
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
