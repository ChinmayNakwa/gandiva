"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface MarketFilters {
  category: string;
  maxPrice: string;
  sort: string;
}

export function MarketFiltersBar({
  value,
  onChange,
  count,
}: {
  value: MarketFilters;
  onChange: (next: MarketFilters) => void;
  count?: number;
}) {
  const set = (patch: Partial<MarketFilters>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="f-cat" className="text-xs text-muted-foreground">
          Category
        </Label>
        <Select
          value={value.category || "all"}
          onValueChange={(v) => set({ category: v === "all" ? "" : v })}
        >
          <SelectTrigger id="f-cat" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="scraping">scraping</SelectItem>
            <SelectItem value="data">data</SelectItem>
            <SelectItem value="inference">inference</SelectItem>
          </SelectContent>
        </Select>
      </div>

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

      <div className="ml-auto font-mono text-xs text-muted-foreground">
        {count ?? 0} service{count === 1 ? "" : "s"}
      </div>
    </div>
  );
}
