import { ExternalLinkIcon } from "lucide-react";
import { short } from "@/lib/format";

export function TxLink({ hash }: { hash?: string | null }) {
  if (!hash) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`https://sepolia.basescan.org/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-4 hover:underline"
    >
      {short(hash)}
      <ExternalLinkIcon className="size-3" />
    </a>
  );
}

export function AddrLink({ address }: { address?: string | null }) {
  if (!address) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`https://sepolia.basescan.org/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      title={address}
    >
      {short(address)}
    </a>
  );
}
