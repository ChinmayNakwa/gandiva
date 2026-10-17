import { BadgeCheckIcon } from "lucide-react";
import type { CredibilityLevel } from "@/lib/types";
import { cn } from "cn";

const TONE: Record<CredibilityLevel, string> = {
  high: "border-ok/40 bg-ok/10 text-ok",
  medium: "border-info/40 bg-info/10 text-info",
  low: "border-warn/40 bg-warn/10 text-warn",
  unproven: "border-bad/40 bg-bad/10 text-bad",
};

export function CredibilityBadge({ score, level, className }: { score: number; level: CredibilityLevel; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide", TONE[level], className)}
      title="Credibility from proofs a seller can give without KYC: x402 conformance, payTo signature, track record, stake, wallet history, HTTPS, listing age"
    >
      <BadgeCheckIcon className="size-3" />
      {level} · {score}
    </span>
  );
}
