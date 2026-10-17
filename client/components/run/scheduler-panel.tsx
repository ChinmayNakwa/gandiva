"use client";

import { ListOrderedIcon, TrophyIcon } from "lucide-react";
import { useQueue } from "@/lib/hooks";
import type { PriorityFactor } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clock } from "@/lib/format";

const FACTORS: { key: PriorityFactor; label: string; color: string; hint: string }[] = [
  { key: "retry", label: "retry", color: "var(--bad)", hint: "a settlement retry: money is already in motion" },
  { key: "waited", label: "waited", color: "var(--info)", hint: "time queued, so nothing starves" },
  { key: "progress", label: "run progress", color: "var(--primary)", hint: "share of the run's budget already spent" },
  { key: "reliability", label: "reliability", color: "var(--ok)", hint: "the seller's reputation" },
  { key: "smallness", label: "small payment", color: "var(--gold)", hint: "cheaper calls lock less money" },
];

/** Weighted factor contributions as one stacked bar; the full width is priority 1.0. */
function PriorityBar({ factors, weights }: { factors: Record<PriorityFactor, number>; weights: Record<PriorityFactor, number> }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      {FACTORS.map((f) => (
        <div key={f.key} title={`${f.label}: ${factors[f.key].toFixed(2)} × ${weights[f.key]}`} style={{ width: `${weights[f.key] * factors[f.key] * 100}%`, background: f.color }} className="h-full" />
      ))}
    </div>
  );
}

/**
 * The payment scheduler: when calls contend for the same wallet or seller at the same moment, the one with the highest
 * priority starts first. Shows the weights, who is waiting now and the latest contention decisions.
 */
export function SchedulerPanel() {
  const { data } = useQueue();
  if (!data) return null;
  const { weights } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrderedIcon className="size-4" /> Priority scheduling
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          At most {data.perWallet} payments per wallet and {data.perSeller} per seller run at once. When more want to start, the highest priority goes first; equal priority keeps arrival order, and nothing waits longer than {data.maxWaitMs / 1000} s.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {FACTORS.map((f) => (
            <span key={f.key} className="flex items-center gap-1.5 text-[11px]" title={f.hint}>
              <span className="size-2.5 rounded-sm" style={{ background: f.color }} />
              {f.label} <span className="font-mono text-muted-foreground">×{weights[f.key]}</span>
            </span>
          ))}
        </div>

        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">Waiting now</h4>
          {data.queue.length ? (
            <ol className="flex flex-col gap-1.5">
              {data.queue.map((q) => (
                <li key={`${q.label}-${q.position}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_7rem_3rem] items-center gap-2 text-[11px]">
                  <span className="font-mono text-muted-foreground">#{q.position}</span>
                  <span className="truncate font-mono">{q.label}</span>
                  <PriorityBar factors={q.factors} weights={weights} />
                  <span className="text-right font-mono">{q.priority.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px] text-muted-foreground">No call is waiting; every payment started straight away.</p>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">Recent contention</h4>
          {data.contention.length ? (
            <ul className="flex flex-col gap-3">
              {data.contention.slice(0, 6).map((e, i) => (
                <li key={`${e.ts}-${i}`} className="rounded-lg border border-border bg-background/40 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                    <span className="flex items-center gap-1.5 font-mono">
                      <TrophyIcon className="size-3 text-gold" /> {e.winner.label}
                    </span>
                    <span className="font-mono text-muted-foreground">{clock(e.ts)}</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_7rem_3rem] items-center gap-2 text-[11px]">
                    <span className="truncate text-ok">started</span>
                    <PriorityBar factors={e.winner.factors} weights={weights} />
                    <span className="text-right font-mono">{e.winner.priority.toFixed(2)}</span>
                    {e.waiting.map((w, j) => (
                      <div key={j} className="contents">
                        <span className="truncate font-mono text-muted-foreground">{w.label}</span>
                        <PriorityBar factors={w.factors} weights={weights} />
                        <span className="text-right font-mono text-muted-foreground">{w.priority.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{e.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">No contention yet. Start two runs at once, or one run with a high max concurrency, to see the scheduler choose.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
