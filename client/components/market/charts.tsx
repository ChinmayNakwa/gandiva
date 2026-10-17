"use client";

import type { LedgerStatus } from "@/lib/types";
import { cn } from "cn";

/** Series colours, in rank order: the buyer's first choice is always the primary colour. */
export const SERIES = ["var(--primary)", "var(--info)", "var(--gold)", "var(--warn)", "var(--bad)", "var(--muted-foreground)"];

/** Radar of 0..1 values on shared axes, one polygon per series. */
export function Radar({
  axes,
  series,
  size = 260,
}: {
  axes: { key: string; label: string }[];
  series: { name: string; color: string; values: Record<string, number>; emphasis?: boolean }[];
  size?: number;
}) {
  const c = size / 2;
  const r = c - 44;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const ring = (v: number) => axes.map((_, i) => point(i, v).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[320px]" role="img" aria-label="Radar chart of selection parameters">
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke="var(--border)" strokeWidth={1} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.2);
        return (
          <g key={a.key}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={lx} y={ly} textAnchor={lx < c - 4 ? "end" : lx > c + 4 ? "start" : "middle"} dominantBaseline="middle" className="fill-muted-foreground font-mono text-[9px]">
              {a.label}
            </text>
          </g>
        );
      })}
      {[...series].reverse().map((s) => (
        <polygon
          key={s.name}
          points={axes.map((a, i) => point(i, Math.max(0.02, s.values[a.key] ?? 0)).join(",")).join(" ")}
          fill={s.color}
          fillOpacity={s.emphasis ? 0.28 : 0.1}
          stroke={s.color}
          strokeWidth={s.emphasis ? 2.2 : 1.2}
          strokeDasharray={s.emphasis ? undefined : "4 3"}
        />
      ))}
    </svg>
  );
}

/** One horizontal bar per candidate for a single 0..1 metric. */
export function MetricBars({
  rows,
}: {
  rows: { name: string; value: number; label: string; color: string; highlight?: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-[11px]">
          <span className={cn("truncate font-mono", r.highlight ? "text-foreground" : "text-muted-foreground")}>{r.name}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(Math.max(0.02, r.value) * 100)}%`, background: r.color }} />
          </div>
          <span className="text-right font-mono text-muted-foreground">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<LedgerStatus, string> = {
  paid: "var(--ok)",
  paid_output_rejected: "var(--bad)",
  refused: "var(--warn)",
  failed_not_charged: "var(--muted-foreground)",
  unconfirmed: "var(--info)",
};

/** The last calls to a seller: a latency line over status-coloured dots (oldest left). */
export function CallStrip({ history }: { history: { status: LedgerStatus; latencyMs: number; ts: string }[] }) {
  if (!history.length) return <span className="font-mono text-[11px] text-muted-foreground">no calls yet</span>;
  const w = 160;
  const h = 34;
  const max = Math.max(...history.map((x) => x.latencyMs), 1);
  const step = history.length > 1 ? (w - 8) / (history.length - 1) : 0;
  const pts = history.map((x, i) => [4 + i * step, h - 8 - (x.latencyMs / max) * (h - 14)] as const);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[34px] w-[160px]" role="img" aria-label="Recent calls: latency and outcome">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--border)" strokeWidth={1.2} />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.6} fill={STATUS_COLOR[history[i].status]}>
          <title>{`${history[i].status.replace(/_/g, " ")} · ${history[i].latencyMs} ms · ${history[i].ts.slice(11, 19)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Stacked bar of credibility points by check, out of 100. */
export function PointsBar({ parts }: { parts: { label: string; points: number; max: number; color: string }[] }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Credibility points by check">
      {parts.map((p) => (
        <div key={p.label} title={`${p.label}: ${p.points}/${p.max}`} style={{ width: `${p.points}%`, background: p.color }} className="h-full border-r border-background/60 last:border-r-0" />
      ))}
    </div>
  );
}
