"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveListing, type ListingForm } from "@/lib/api";
import { toUnits, usdc } from "@/lib/format";
import type { Service } from "@/lib/types";

const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

interface FormState {
  id?: string;
  name: string;
  category: string;
  priceUsdc: string;
  endpoint: string;
  method: "GET" | "POST";
  description: string;
  inputSchema: string;
  outputSchema: string;
}

const STARTER: FormState = {
  name: "",
  category: "data",
  priceUsdc: "0.002",
  endpoint: "",
  method: "GET",
  description: "",
  inputSchema: JSON.stringify({ type: "object", properties: { city: { type: "string" } }, required: ["city"] }, null, 2),
  outputSchema: JSON.stringify({ type: "object", properties: { temperature_c: { type: "number" } }, required: ["temperature_c"] }, null, 2),
};

export const fromService = (s: Service): FormState => ({
  id: s.id,
  name: s.name,
  category: s.category,
  priceUsdc: usdc(s.price),
  endpoint: s.endpoint,
  method: s.method,
  description: s.description,
  inputSchema: JSON.stringify(s.inputSchema, null, 2),
  outputSchema: JSON.stringify(s.outputSchema, null, 2),
});

function parseSchema(label: string, text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object, e.g. { "type": "object" }.`);
  return value as Record<string, unknown>;
}

export function ListingFormCard({
  wallet,
  editing,
  onSaved,
  onCancel,
}: {
  wallet: string;
  editing: Service | null;
  onSaved: (s: Service) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => (editing ? fromService(editing) : STARTER));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setError(null);
    try {
      const price = toUnits(form.priceUsdc);
      if (!price || Number(price) === 0) throw new Error("Price must be a number like 0.002 (USDC, up to 6 decimals).");
      if (Number(price) > 100_000) throw new Error("Price can be at most 0.10 USDC per call.");
      const body: ListingForm = {
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(),
        category: form.category,
        endpoint: form.endpoint.trim(),
        method: form.method,
        price,
        description: form.description.trim(),
        inputSchema: parseSchema("Input schema", form.inputSchema),
        outputSchema: parseSchema("Output schema", form.outputSchema),
      };
      setSaving(true);
      const saved = await saveListing(body);
      onSaved(saved);
      if (!editing) setForm(STARTER);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the listing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving) void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input id="name" className="font-mono" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="my-weather-api" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category" className="text-xs text-muted-foreground">
            Category
          </Label>
          <select id="category" className={FIELD} value={form.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="data">data</option>
            <option value="inference">inference</option>
            <option value="scraping">scraping</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endpoint" className="text-xs text-muted-foreground">
            Endpoint URL (must answer with an x402 402 before payment)
          </Label>
          <Input id="endpoint" className="font-mono" value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} placeholder="https://my-server.example/weather" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="method" className="text-xs text-muted-foreground">
            Method
          </Label>
          <select id="method" className={FIELD} value={form.method} onChange={(e) => set({ method: e.target.value as "GET" | "POST" })}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price" className="text-xs text-muted-foreground">
            Price (USDC / call)
          </Label>
          <Input id="price" inputMode="decimal" className="font-mono" value={form.priceUsdc} onChange={(e) => set({ priceUsdc: e.target.value })} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description" className="text-xs text-muted-foreground">
          Description
        </Label>
        <Input id="description" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What does it do? (the buyer agent reads this)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="input" className="text-xs text-muted-foreground">
            Input schema (JSON Schema of the query or body)
          </Label>
          <textarea id="input" rows={8} spellCheck={false} className={FIELD + " resize-y font-mono text-xs"} value={form.inputSchema} onChange={(e) => set({ inputSchema: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="output" className="text-xs text-muted-foreground">
            Output schema (JSON Schema of the answer; the buyer checks it)
          </Label>
          <textarea id="output" rows={8} spellCheck={false} className={FIELD + " resize-y font-mono text-xs"} value={form.outputSchema} onChange={(e) => set({ outputSchema: e.target.value })} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Payments for this listing go to your signed-in wallet <span className="font-mono text-foreground">{wallet}</span>. The registry asks your endpoint for its 402 and shows whether it matches what you listed here.
      </p>

      {error ? <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || !form.name.trim() || !form.endpoint.trim()}>
          {saving ? "Saving and checking the endpoint…" : editing ? "Save changes" : "List my seller"}
        </Button>
        {editing ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
