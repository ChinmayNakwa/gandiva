"use client";

import { useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { SearchIcon } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { spring } from "@/lib/motion";

export interface MarketFilters {
  category: string;
  maxPrice: string;
  sort: string;
}

export const DEFAULT_FILTERS: MarketFilters = { category: "", maxPrice: "", sort: "rank" };

const CATEGORIES = [
  { value: "", label: "all" },
  { value: "scraping", label: "scraping" },
  { value: "data", label: "data" },
  { value: "inference", label: "inference" },
];

const noop = () => () => {};

/** "⌘K" on Apple keyboards, "Ctrl K" elsewhere (Ctrl until hydrated). */
function useShortcutLabel() {
  const mac = useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  return mac ? "⌘K" : "Ctrl K";
}

export function MarketFiltersBar({
  value,
  onChange,
  onSearch,
  count,
}: {
  value: MarketFilters;
  onChange: (next: MarketFilters) => void;
  onSearch: () => void;
  count?: number;
}) {
  const set = (patch: Partial<MarketFilters>) =>
    onChange({ ...value, ...patch });
  const shortcut = useShortcutLabel();

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Category"
          className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 scrollbar-none"
        >
          {CATEGORIES.map((c) => {
            const active = value.category === c.value;
            return (
              <button
                key={c.label}
                type="button"
                aria-pressed={active}
                onClick={() => set({ category: c.value })}
                className={cn(
                  "relative isolate shrink-0 rounded-full px-3.5 py-1.5 font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="market-category"
                    transition={spring.snappy}
                    className="absolute inset-0 -z-10 rounded-full bg-primary"
                  />
                ) : null}
                {c.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onSearch}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-64"
        >
          <SearchIcon className="size-4" />
          Search services
          <kbd className="ml-auto rounded border pointer-coarse:hidden border-border bg-muted px-1.5 font-mono text-[10px]">
            {shortcut}
          </kbd>
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-max" className="text-xs text-muted-foreground">
            Max price (USDC)
          </Label>
          <Input
            id="f-max"
            type="number"
            min={0}
            step={0.001}
            placeholder="any"
            className="w-36 font-mono"
            value={value.maxPrice}
            onChange={(e) => set({ maxPrice: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-sort" className="text-xs text-muted-foreground">
            Sort
          </Label>
          <Select value={value.sort} onValueChange={(v) => set({ sort: v })}>
            <SelectTrigger id="f-sort" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rank">reputation (buyer&apos;s order)</SelectItem>
              <SelectItem value="price">price</SelectItem>
              <SelectItem value="latency">latency</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div aria-live="polite" className="ml-auto font-mono text-xs text-muted-foreground">
          {count ?? 0} service{count === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}
