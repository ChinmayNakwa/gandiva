"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "cn";
import { RowCard, RowCards, WIDE } from "@/components/row-cards";
import { StatusBadge } from "@/components/status-badge";
import { TxLink } from "@/components/tx-link";
import { clock, short, usdc } from "@/lib/format";
import { useFreshIds } from "@/lib/use-fresh";
import type { LedgerEntry } from "@/lib/types";

interface Node {
  address: string;
  name: string;
  col: number;
  volume: number;
  x: number;
  y: number;
}

interface Edge {
  key: string;
  from: string;
  to: string;
  count: number;
  rejected: number;
  total: number;
  payments: LedgerEntry[];
  path: string;
}

const W = 1000;
const NODE_W = 210;
const NODE_H = 38;
const ROW = 56;
const PAD = 24;

/** Wallets and who paid whom, from ledger rows where money moved. Columns: only pays | pays and is paid (chains) | only paid. */
function buildFlow(entries: LedgerEntry[], demoBuyer: string | null | undefined) {
  const moved = entries.filter((e) => (e.status === "paid" || e.status === "paid_output_rejected") && Number(e.paid || "0") > 0);
  const names = new Map<string, Set<string>>();
  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  const edges = new Map<string, Omit<Edge, "path">>();
  for (const e of moved) {
    const from = e.buyer.toLowerCase();
    const to = e.seller.toLowerCase();
    const paid = Number(e.paid);
    (names.get(to) ?? names.set(to, new Set()).get(to)!).add(e.service_name);
    out.set(from, (out.get(from) ?? 0) + paid);
    inn.set(to, (inn.get(to) ?? 0) + paid);
    const key = `${from}>${to}`;
    const edge = edges.get(key) ?? { key, from, to, count: 0, rejected: 0, total: 0, payments: [] };
    edge.count++;
    edge.total += paid;
    if (e.status === "paid_output_rejected") edge.rejected++;
    edge.payments.push(e);
    edges.set(key, edge);
  }

  const nameOf = (a: string) => {
    const n = [...(names.get(a) ?? [])];
    if (n.length) return n.length > 1 ? `${n[0]} +${n.length - 1}` : n[0];
    return a === demoBuyer?.toLowerCase() ? "Scout (demo wallet)" : `agent ${short(a)}`;
  };
  const all = new Set([...out.keys(), ...inn.keys()]);
  const hasMiddle = [...all].some((a) => out.has(a) && inn.has(a));
  const cols = hasMiddle ? [PAD, (W - NODE_W) / 2, W - NODE_W - PAD] : [PAD, W - NODE_W - PAD];
  const byCol: Node[][] = cols.map(() => []);
  for (const a of all) {
    const col = !inn.has(a) ? 0 : !out.has(a) ? cols.length - 1 : 1;
    byCol[col].push({ address: a, name: nameOf(a), col, volume: (out.get(a) ?? 0) + (inn.get(a) ?? 0), x: cols[col], y: 0 });
  }
  const rows = Math.max(1, ...byCol.map((c) => c.length));
  const height = rows * ROW + PAD * 2;
  const nodes = new Map<string, Node>();
  byCol.forEach((col) => {
    col.sort((a, b) => b.volume - a.volume);
    const top = (height - col.length * ROW) / 2;
    col.forEach((n, i) => {
      n.y = top + i * ROW + (ROW - NODE_H) / 2;
      nodes.set(n.address, n);
    });
  });

  const withPaths: Edge[] = [...edges.values()].sort((a, b) => b.total - a.total).map((e) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const [x1, y1, x2, y2] = [a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2];
    const mx = (x1 + x2) / 2;
    return { ...e, path: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` };
  });
  const max = withPaths.reduce((m, e) => (e.total > m ? e.total : m), 1);
  const total = withPaths.reduce((s, e) => s + e.total, 0);
  return { nodes: [...nodes.values()], edges: withPaths, height, max, total, payments: moved.length };
}

/** One dot that travels along an edge when a new payment lands. SMIL starts with the document, so it is begun by hand. */
function FlowDot({ path }: { path: string }) {
  const move = useRef<SVGAnimateMotionElement>(null);
  const fade = useRef<SVGAnimateElement>(null);
  useEffect(() => {
    move.current?.beginElement();
    fade.current?.beginElement();
  }, []);
  return (
    <circle r={5} className="fill-primary" opacity={0}>
      <animateMotion ref={move} path={path} dur="1.4s" begin="indefinite" fill="freeze" />
      <animate ref={fade} attributeName="opacity" values="1;1;0" keyTimes="0;0.8;1" dur="1.4s" begin="indefinite" fill="freeze" />
    </circle>
  );
}

const pressable = (select: () => void) => ({
  tabIndex: 0,
  role: "button" as const,
  onClick: select,
  onKeyDown: (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select();
    }
  },
});

export function MoneyFlow({ entries, demoBuyer }: { entries: LedgerEntry[]; demoBuyer?: string | null }) {
  const flow = buildFlow(entries, demoBuyer);
  const [selected, setSelected] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const isFresh = useFreshIds(entries.length ? entries.map((e) => e.id) : undefined);
  const name = (a: string) => flow.nodes.find((n) => n.address === a)?.name ?? short(a);
  const touches = (e: Edge) => !selected || e.key === selected || e.from === selected || e.to === selected;
  const shown = flow.edges.filter(touches);
  const toggle = (key: string) => setSelected((s) => (s === key ? null : key));

  if (!flow.edges.length) {
    return (
      <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No money has moved yet. Run a task and the payments will draw themselves here.
      </p>
    );
  }

  const describe = (e: Edge) =>
    `${name(e.from)} paid ${name(e.to)} ${e.count}× for ${usdc(e.total)} USDC${e.rejected ? `, ${e.rejected} with output rejected` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs text-muted-foreground">
        {flow.nodes.length} wallets · {flow.payments} payments · {usdc(flow.total)} USDC moved · line width = USDC ·{" "}
        <span className="text-bad">dashed = paid, output rejected</span>
      </p>

      <div className={cn("overflow-hidden rounded-2xl border border-border bg-card/50", WIDE.md.table)}>
        <svg viewBox={`0 0 ${W} ${flow.height}`} className="h-auto w-full" role="group" aria-label="Money flow between wallets">
          {flow.edges.map((e) => {
            const width = 1.5 + (6 * e.total) / flow.max;
            const active = touches(e);
            return (
              <g
                key={e.key}
                {...pressable(() => toggle(e.key))}
                aria-label={describe(e)}
                aria-pressed={selected === e.key}
                className={cn("cursor-pointer outline-none transition-opacity focus-visible:[&>path:last-child]:stroke-ring", !active && "opacity-20")}
              >
                <path d={e.path} fill="none" stroke="transparent" strokeWidth={16} />
                <path
                  d={e.path}
                  fill="none"
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeDasharray={e.rejected === e.count ? "6 6" : undefined}
                  className={e.rejected === e.count ? "stroke-bad" : "stroke-primary/70"}
                />
              </g>
            );
          })}
          {!reduced &&
            flow.edges.flatMap((e) => e.payments.filter((p) => isFresh(p.id)).map((p) => <FlowDot key={p.id} path={e.path} />))}
          {flow.nodes.map((n) => (
            <g
              key={n.address}
              {...pressable(() => toggle(n.address))}
              aria-label={`${n.name}, ${usdc(n.volume)} USDC in and out`}
              aria-pressed={selected === n.address}
              className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-ring"
            >
              <rect
                x={n.x}
                y={n.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                strokeWidth={selected === n.address ? 2 : 1}
                className={cn("fill-card", selected === n.address ? "stroke-primary" : "stroke-border")}
              />
              <text x={n.x + 12} y={n.y + 16} className="fill-foreground text-[13px]">
                {n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}
              </text>
              <text x={n.x + 12} y={n.y + 30} className="fill-muted-foreground font-mono text-[10px]">
                {short(n.address)} · {usdc(n.volume)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <RowCards label="Payments between wallets" at="md">
        {flow.edges.map((e) => (
          <RowCard
            key={e.key}
            title={`${name(e.from)} → ${name(e.to)}`}
            sub={`${short(e.from)} → ${short(e.to)}`}
            status={e.rejected ? <StatusBadge status="paid_output_rejected" /> : <StatusBadge status="paid" />}
            amount={usdc(e.total)}
            fields={[
              ["payments", e.count],
              ["rejected", e.rejected],
              ["last tx", <TxLink key="tx" hash={e.payments[0]?.tx_hash} />],
            ]}
          />
        ))}
      </RowCards>

      {selected ? (
        <section aria-live="polite" className={cn("rounded-2xl border border-border p-4", WIDE.md.table)}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-heading text-sm font-medium">
              {flow.edges.find((e) => e.key === selected) ? describe(flow.edges.find((e) => e.key === selected)!) : `Payments in and out of ${name(selected)}`}
            </h2>
            <button type="button" onClick={() => setSelected(null)} className="font-mono text-xs text-muted-foreground hover:text-foreground">
              clear
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {shown
              .flatMap((e) => e.payments)
              .sort((a, b) => b.id - a.id)
              .slice(0, 30)
              .map((p) => (
                <li key={p.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 py-2 font-mono text-xs">
                  <span className="text-muted-foreground">{clock(p.ts)}</span>
                  <span className="truncate">
                    {name(p.buyer.toLowerCase())} → {p.service_name}
                  </span>
                  <StatusBadge status={p.status} />
                  <span className="text-primary">{usdc(p.paid)}</span>
                  <TxLink hash={p.tx_hash} />
                </li>
              ))}
          </ul>
        </section>
      ) : (
        <p className={cn("text-xs text-muted-foreground", WIDE.md.table)}>Click or press Enter on a line or a wallet to see its transactions.</p>
      )}
    </div>
  );
}
