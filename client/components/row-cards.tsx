import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Wide tables become a stack of cards below a breakpoint, so phones never
 * scroll sideways. The table and the cards are both rendered; CSS shows one
 * (display: none also hides the other from screen readers).
 */
export const WIDE = {
  md: { table: "hidden md:block", cards: "md:hidden" },
  lg: { table: "hidden lg:block", cards: "lg:hidden" },
} as const;

export type Breakpoint = keyof typeof WIDE;

export function RowCards({
  label,
  at,
  children,
}: {
  label: string;
  at: Breakpoint;
  children: ReactNode;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("flex flex-col gap-3", WIDE[at].cards)}
    >
      {children}
    </ul>
  );
}

export function RowCard({
  title,
  sub,
  status,
  amount,
  fields,
  notes = [],
  flash,
}: {
  title: ReactNode;
  sub?: ReactNode;
  status: ReactNode;
  /** Already formatted USDC. */
  amount: string;
  fields: [string, ReactNode][];
  notes?: ReactNode[];
  /** An arrival animation class; it ends transparent, so it sits on an inner layer. */
  flash?: string;
}) {
  return (
    <li className="rounded-xl border border-border bg-card">
      <div className={cn("flex flex-col gap-3 rounded-xl p-4", flash)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            {sub ? (
              <div className="font-mono text-[11px] break-words text-muted-foreground">
                {sub}
              </div>
            ) : null}
          </div>
          <div className="shrink-0">{status}</div>
        </div>
        <div className="font-mono text-xl text-primary">
          {amount} <span className="text-xs text-muted-foreground">USDC</span>
        </div>
        {/* gap-y-2 keeps stacked links (buyer, seller, tx) 24px apart for touch. */}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 font-mono text-[11px]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {notes.filter(Boolean).map((n, i) => (
          <p key={i} className="text-[11px] text-muted-foreground">
            {n}
          </p>
        ))}
      </div>
    </li>
  );
}
