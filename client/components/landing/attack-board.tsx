"use client";

import { ShieldAlertIcon } from "lucide-react";
import { cn } from "cn";
import { useAttacks } from "@/lib/hooks";
import { ago, usdc } from "@/lib/format";
import { useNow } from "@/lib/clock";
import { Counter } from "./counter";
import { Reveal } from "./reveal";

/** Live count of every attack the buyer stopped, read from the ledger (refusals, rejected output) and seller-side replays. */
export function AttackBoard() {
  const { data } = useAttacks();
  const now = useNow(10_000);

  return (
    <Reveal>
      <div className="mt-10 rounded-2xl border border-border bg-card/50 p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlertIcon className="size-5 text-primary" />
            <h3 className="font-heading text-base font-medium">
              Attacks blocked so far
            </h3>
          </div>
          <p className="sr-only" aria-live="polite">
            {data ? `${data.total} attacks blocked so far` : ""}
          </p>
          <p className="font-mono text-xs text-muted-foreground" aria-hidden>
            <span className="text-2xl text-primary">
              <Counter value={data?.total ?? 0} />
            </span>{" "}
            blocked · {usdc(data?.notPaidUnits)} USDC asked for and never paid
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {(data?.attacks ?? []).map((a) => (
            <li
              key={a.kind}
              className={cn(
                "flex flex-col gap-1 rounded-xl border border-border p-3",
                a.count ? "bg-background" : "opacity-60",
              )}
            >
              <span className="text-xs text-muted-foreground">{a.label}</span>
              <span className="font-mono text-xl text-foreground">
                <Counter value={a.count} />
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {a.lastAt && now ? `last ${ago(a.lastAt, now)}` : "none yet"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  );
}
