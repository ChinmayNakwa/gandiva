import { cn } from "cn";
import type { AgentWalletInfo } from "@/lib/types";

type SpendCap = AgentWalletInfo["spendCap"];

/** "0.500000" → "0.5" */
const trim = (usdc: string) => String(Number(usdc));

/**
 * How much of the rolling spend limit is used. The fill moves on transform only
 * and turns amber past 70%, red past 90%, so a demo shows the cap closing in.
 */
export function SpendCapBar({ cap, label }: { cap: SpendCap; label: string }) {
  if (!cap.enabled) {
    return <p className="text-[11px] text-muted-foreground">{label}: no spend limit set.</p>;
  }
  const limit = Number(cap.limitUsdc);
  const used = Math.min(Number(cap.usedUsdc), limit);
  const share = limit > 0 ? used / limit : 0;
  const tone = share >= 0.9 ? "bg-bad" : share >= 0.7 ? "bg-warn" : "bg-primary";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-muted-foreground">
        <span>
          {label} · per {cap.windowMinutes} min
        </span>
        <span className="font-mono">
          <span className={cn(share >= 0.9 ? "text-bad" : share >= 0.7 ? "text-warn" : "text-foreground")}>
            {trim(cap.usedUsdc)}
          </span>{" "}
          of {trim(cap.limitUsdc)} USDC used · {trim(cap.remainingUsdc)} left
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label}, used`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={`${trim(cap.usedUsdc)} of ${trim(cap.limitUsdc)} USDC used in the last ${cap.windowMinutes} minutes`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full origin-left rounded-full transition-[transform,background-color] duration-700 ease-out-quint motion-reduce:transition-none",
            tone,
          )}
          style={{ transform: `scaleX(${share})` }}
        />
      </div>
    </div>
  );
}
