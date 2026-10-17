"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowDownIcon, CrownIcon, ScaleIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useCompare } from "@/lib/hooks";
import type { Category, CompareCandidate, CompareMetric, CompareResponse, CredibilityCheck } from "@/lib/types";
import { pct, usdc } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddrLink } from "@/components/tx-link";
import { CallStrip, MetricBars, PointsBar, Radar, SERIES } from "./charts";
import { CredibilityBadge } from "./credibility-badge";
import { cn } from "cn";

const AXES: { key: CompareMetric; label: string }[] = [
  { key: "reputation", label: "reputation" },
  { key: "successRate", label: "success" },
  { key: "cheapness", label: "cheapness" },
  { key: "speed", label: "speed" },
  { key: "credibility", label: "credibility" },
  { key: "stake", label: "stake" },
];

const RULE_LABEL: Record<CompareResponse["decisions"][number]["rule"], string> = {
  verification: "402 check",
  reputation: "reputation",
  price: "price",
  credibility: "credibility",
  latency: "latency",
  tie: "tie",
};

const CHECK_COLOR: Record<CredibilityCheck["id"], string> = {
  protocol: "var(--primary)",
  ownership: "var(--info)",
  track_record: "var(--ok)",
  stake: "var(--gold)",
  wallet_history: "var(--warn)",
  transport: "var(--muted-foreground)",
  tenure: "var(--border)",
};

function metricLabel(m: CompareMetric, c: CompareCandidate) {
  switch (m) {
    case "reputation":
      return pct(c.reputation.score);
    case "successRate":
      return c.reputation.attempts ? `${c.reputation.successes}/${c.reputation.attempts}` : "untried";
    case "cheapness":
      return `${usdc(c.price)}`;
    case "speed":
      return c.reputation.medianLatencyMs ? `${c.reputation.medianLatencyMs} ms` : "n/a";
    case "credibility":
      return c.credibility ? `${c.credibility.score}/100` : "…";
    case "stake":
      return `${Number(c.stake.stakedUsdc).toFixed(3)}`;
  }
}

/**
 * Why the buyer would pick one seller over the others in a category: the ranking ladder with the rule that decided each
 * step, a radar of every parameter, per-parameter bars, recent call history and the selected seller's credibility checks.
 */
export function CompareDashboard({ category, selected, onClose, onSelect }: { category: Category; selected: string; onClose: () => void; onSelect: (id: string) => void }) {
  const { data, error, isLoading } = useCompare(category, selected);
  const [metric, setMetric] = useState<CompareMetric>("reputation");

  if (error) return <div className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">Could not load the comparison: {String(error.message ?? error)}</div>;
  if (isLoading || !data) return <Skeleton className="h-[520px] rounded-2xl" />;

  const cands = data.candidates;
  const sel = cands.find((c) => c.id === selected) ?? cands[0];
  const top = cands[0];
  const color = (c: CompareCandidate) => SERIES[Math.min(c.rank - 1, SERIES.length - 1)];
  const radarSeries = [top, ...(sel && sel.id !== top.id ? [sel] : []), ...cands.filter((c) => c.id !== top.id && c.id !== sel?.id).slice(0, 2)].map((c) => ({
    name: c.name,
    color: color(c),
    values: c.metrics,
    emphasis: c.id === top.id || c.id === sel?.id,
  }));

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex flex-col gap-5 rounded-2xl border border-primary/30 bg-card/70 p-5 shadow-sm"
      aria-label="Seller comparison"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <ScaleIcon className="size-3.5" /> seller comparison · {category}
          </div>
          <h2 className="mt-1 font-display text-2xl">Why the buyer picks {top?.name}</h2>
          {data.selection ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{data.selection.verdict}</p> : null}
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            comparing {data.scope}
            {data.otherInCategory ? ` · ${data.otherInCategory} other ${category} seller(s) do a different job and are left out` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close comparison">
          <XIcon /> Close
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Ranking ladder: each step names the rule that decided it. */}
        <div className="flex flex-col gap-1">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">Ranking, best first</h3>
          {cands.map((c, i) => {
            const d = data.decisions[i - 1];
            return (
              <div key={c.id}>
                {d ? (
                  <div className="flex items-center gap-2 py-1 pl-4 text-[11px] text-muted-foreground" title={d.detail}>
                    <ArrowDownIcon className="size-3" />
                    <span className="rounded bg-muted px-1.5 font-mono text-[10px] uppercase">{RULE_LABEL[d.rule]}</span>
                    <span className="truncate">{d.detail}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                    c.id === sel?.id ? "border-primary/60 bg-primary/10" : "border-border bg-background/40 hover:border-primary/30",
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px] text-background" style={{ background: color(c) }}>
                    {c.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-mono text-sm">
                      {c.name}
                      {c.rank === 1 ? <CrownIcon className="size-3.5 text-gold" /> : null}
                      {c.verification === "mismatch" ? <ShieldAlertIcon className="size-3.5 text-bad" /> : null}
                    </span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {usdc(c.price)} USDC · rep {pct(c.reputation.score)} · {c.reputation.medianLatencyMs ?? "n/a"} ms
                    </span>
                  </span>
                  {c.credibility ? <CredibilityBadge score={c.credibility.score} level={c.credibility.level} /> : null}
                </button>
              </div>
            );
          })}
        </div>

        {/* Radar: the first choice, the selected seller and up to two more. */}
        <div className="flex flex-col items-center gap-2">
          <h3 className="self-start text-xs font-medium uppercase tracking-widest text-muted-foreground">Parameters (outer = better for the buyer)</h3>
          <Radar axes={AXES} series={radarSeries} />
          <div className="flex flex-wrap justify-center gap-3 text-[11px]">
            {radarSeries.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5 font-mono">
                <span className="size-2.5 rounded-sm" style={{ background: s.color, opacity: s.emphasis ? 1 : 0.6 }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* One parameter at a time across every candidate. */}
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {AXES.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setMetric(a.key)}
              className={cn("rounded-full border px-2.5 py-0.5 font-mono text-[11px]", metric === a.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {a.label}
            </button>
          ))}
        </div>
        <MetricBars rows={cands.map((c) => ({ name: c.name, value: c.metrics[metric], label: metricLabel(metric, c), color: color(c), highlight: c.id === sel?.id }))} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Credibility checks of the selected seller. */}
        {sel?.credibility ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Credibility of {sel.name} (no KYC)</h3>
              <CredibilityBadge score={sel.credibility.score} level={sel.credibility.level} />
            </div>
            <PointsBar parts={sel.credibility.checks.map((c) => ({ label: c.label, points: c.points, max: c.max, color: CHECK_COLOR[c.id] }))} />
            <ul className="mt-1 flex flex-col gap-1.5">
              {sel.credibility.checks.map((c) => (
                <li key={c.id} className="grid grid-cols-[0.6rem_8.5rem_3rem_1fr] items-start gap-2 text-[11px]">
                  <span className="mt-1 size-2 rounded-full" style={{ background: CHECK_COLOR[c.id] }} />
                  <span className="font-medium">{c.label}</span>
                  <span className={cn("font-mono", c.status === "pass" ? "text-ok" : c.status === "fail" ? "text-bad" : "text-warn")}>
                    {c.points}/{c.max}
                  </span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              payTo <AddrLink address={sel.payTo} /> · bond {sel.stake.stakedUsdc} USDC{sel.stake.unlockAt ? " (unstaking)" : ""}
            </div>
          </div>
        ) : null}

        {/* Recent outcomes and latency per candidate. */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-4">
          <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Last calls (latency line, outcome dots)</h3>
          {cands.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3">
              <span className={cn("truncate font-mono text-[11px]", c.id === sel?.id ? "text-foreground" : "text-muted-foreground")}>{c.name}</span>
              <CallStrip history={c.history} />
            </div>
          ))}
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {[
              ["paid", "var(--ok)"],
              ["output rejected", "var(--bad)"],
              ["refused", "var(--warn)"],
              ["not charged", "var(--muted-foreground)"],
            ].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: c }} /> {l}
              </span>
            ))}
          </div>
        </div>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">How the buyer ranks sellers</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {data.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </details>
    </motion.section>
  );
}
