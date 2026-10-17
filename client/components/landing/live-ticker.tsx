"use client";

import { ArrowDownIcon } from "lucide-react";
import { useLedger } from "@/lib/hooks";
import { useNow } from "@/lib/clock";
import { ago } from "@/lib/format";
import { Counter } from "./counter";

/** Hero strip: payments settled and USDC moved so far, from the live ledger. */
export function LiveTicker() {
  const { data, error } = useLedger();
  const now = useNow();

  const paid = (data?.entries ?? []).filter((e) => e.status === "paid");
  const volume = Number(data?.totalPaid ?? "0") / 1e6;
  const last = paid[0]?.ts;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span className="relative flex size-2">
          {!error && data ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          ) : null}
          <span
            className={
              "relative inline-flex size-2 rounded-full " +
              (error ? "bg-bad" : data ? "bg-primary" : "bg-muted-foreground")
            }
          />
        </span>
        <span className="uppercase tracking-[0.2em]">
          {error ? "ledger offline" : data ? "live" : "connecting"}
        </span>
      </span>

      {data ? (
        <>
          <span>
            <span className="text-foreground">
              <Counter value={paid.length} />
            </span>{" "}
            payments settled
          </span>
          <span>
            <span className="text-foreground">
              <Counter value={volume} decimals={4} />
            </span>{" "}
            USDC moved
          </span>
          {last && now ? <span>last {ago(last, now)}</span> : null}
          <a
            href="#live"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            watch them land <ArrowDownIcon className="size-3" />
          </a>
        </>
      ) : null}
    </div>
  );
}
