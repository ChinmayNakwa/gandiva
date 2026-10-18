"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadMcpTools, saveMcpServer } from "@/lib/api";
import { toUnits, usdc } from "@/lib/format";
import type { Category, McpInfo, McpSaved, McpToolsLoaded } from "@/lib/types";
import { priceProblem } from "./listing-preview";

const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const DEFAULT_URL = "https://huggingface.co/mcp";
const CATEGORIES: Category[] = ["data", "inference", "scraping"];

/**
 * Sell-tab "MCP server" template: give an MCP server's URL (and bearer token), set one price,
 * and every tool it offers is listed as its own paid tool that pays your wallet.
 * `refresh` re-reads a server that is already listed (new tools added, dropped ones removed).
 */
export function McpServerForm({
  refresh,
  onSaved,
  onCancel,
}: {
  refresh: (McpInfo & { price: string; category: Category }) | null;
  onSaved: (saved: McpSaved) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(refresh?.url ?? DEFAULT_URL);
  const [token, setToken] = useState("");
  const [name, setName] = useState(refresh?.serverId ?? "");
  const [priceUsdc, setPriceUsdc] = useState(refresh ? usdc(refresh.price) : "0.002");
  const [category, setCategory] = useState<Category>(refresh?.category ?? "data");
  const [loaded, setLoaded] = useState<McpToolsLoaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenSaved = Boolean((refresh && refresh.hasToken && url.trim() === refresh.url) || loaded?.hasToken);

  // A different URL or token means the tools shown are no longer the ones that would be listed.
  const edit = (patch: { url?: string; token?: string }) => {
    if (patch.url !== undefined) setUrl(patch.url);
    if (patch.token !== undefined) setToken(patch.token);
    setLoaded(null);
  };

  async function load() {
    setLoading(true);
    setError(null);
    setLoaded(null);
    try {
      setLoaded(await loadMcpTools({ url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that server.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setError(null);
    const problem = priceProblem(priceUsdc);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      const saved = await saveMcpServer({
        url: url.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        category,
        price: toUnits(priceUsdc)!,
      });
      setToken("");
      setLoaded(null);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list the tools.");
    } finally {
      setSaving(false);
    }
  }

  const usable = loaded?.tools.filter((t) => t.usable).length ?? 0;

  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!saving && loaded && usable) void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Give us an MCP server (Streamable HTTP, public https). Every tool on it is listed as its own paid tool: a buyer pays your wallet in USDC, we call the tool on your server with your token, and return its answer. If the
        tool fails or returns nothing, the buyer is not charged.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="m-url" className="text-xs text-muted-foreground">
          MCP server URL
        </Label>
        <Input id="m-url" className="font-mono" value={url} onChange={(e) => edit({ url: e.target.value })} placeholder={DEFAULT_URL} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="m-token" className="text-xs text-muted-foreground">
          Bearer token (optional; stored encrypted, never shown again)
        </Label>
        <Input
          id="m-token"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={token}
          onChange={(e) => edit({ token: e.target.value })}
          placeholder={tokenSaved ? "saved, leave blank to keep" : "leave blank if the server is open"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-price" className="text-xs text-muted-foreground">
            Price per call, every tool (USDC)
          </Label>
          <Input id="m-price" inputMode="decimal" className="font-mono" value={priceUsdc} onChange={(e) => setPriceUsdc(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-category" className="text-xs text-muted-foreground">
            Category
          </Label>
          <select id="m-category" className={FIELD} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="m-name" className="text-xs text-muted-foreground">
            Group name (optional)
          </Label>
          <Input id="m-name" className="font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder={loaded?.name ?? "from the URL"} disabled={Boolean(refresh)} maxLength={40} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={load} disabled={loading || saving || !url.trim()}>
          {loading ? "Reading…" : "Load tools"}
        </Button>
        <Button type="submit" disabled={saving || !loaded || !usable}>
          {saving ? "Listing…" : refresh ? `Refresh ${usable ? `${usable} ` : ""}tools` : `List ${usable ? `all ${usable} ` : ""}tools`}
        </Button>
        {refresh ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">Reading a server is free; up to 20 checks per hour.</span>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error ? <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p> : null}
        {loaded ? (
          <div className="flex flex-col gap-1 rounded-lg border border-border/70 p-3">
            <p className="text-xs text-muted-foreground">
              {loaded.tools.length} {loaded.tools.length === 1 ? "tool" : "tools"} on this server
              {loaded.tools.length > usable ? ` (${loaded.tools.length - usable} cannot be sold)` : ""}. Each will cost {priceUsdc || "…"} USDC per call.
            </p>
            <ul className="flex flex-col gap-1">
              {loaded.tools.map((t) => (
                <li key={t.name} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className={"font-mono " + (t.usable ? "text-foreground" : "text-muted-foreground line-through")}>{t.name}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{t.description || (t.usable ? "" : "its input description is too large or not supported")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </form>
  );
}
