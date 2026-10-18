import { Badge } from "@/components/ui/badge";
import { KIND_LABEL, statusLabel } from "@/lib/format";
import { cn } from "cn";

const TONE: Record<string, string> = {
  paid: "border-ok/40 bg-ok/10 text-ok",
  paid_output_rejected: "border-warn/40 bg-warn/10 text-warn",
  refused: "border-bad/40 bg-bad/10 text-bad",
  replay_rejected: "border-bad/40 bg-bad/10 text-bad",
  failed_not_charged: "border-border bg-muted/40 text-muted-foreground",
  unconfirmed: "border-warn/40 bg-warn/10 text-warn",
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[11px]",
        TONE[status] ?? "border-info/40 bg-info/10 text-info",
        className,
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}

const KIND_TONE: Record<string, string> = {
  chain: "border-primary/40 bg-primary/10 text-primary",
  agent: "border-info/40 bg-info/10 text-info",
  data: "border-border bg-muted/40 text-muted-foreground",
};

/** Chain / AI agent / Data API: what kind of listing this is. */
export function KindBadge({ kind }: { kind: "chain" | "agent" | "data" }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[11px]", KIND_TONE[kind])}>
      {KIND_LABEL[kind]}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-[11px] uppercase">
      {category}
    </Badge>
  );
}
