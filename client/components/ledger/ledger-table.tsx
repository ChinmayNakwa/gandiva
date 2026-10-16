"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { AddrLink, TxLink } from "@/components/tx-link";
import { clock, usdc } from "@/lib/format";
import type { LedgerEntry } from "@/lib/types";

export function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No ledger entries yet — run a task to see the buyer&apos;s spending.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Run</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Listed</TableHead>
            <TableHead className="text-right">Asked</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {clock(e.ts)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {e.run_id ?? "—"}
              </TableCell>
              <TableCell>
                <AddrLink address={e.buyer} />
              </TableCell>
              <TableCell>
                <AddrLink address={e.seller} />
              </TableCell>
              <TableCell>
                <div className="text-sm">{e.service_name}</div>
                {e.reason ? (
                  <div className="max-w-[20rem] text-[11px] text-muted-foreground">
                    {e.reason}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {usdc(e.listed)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {e.asked != null ? usdc(e.asked) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-primary">
                {usdc(e.paid)}
              </TableCell>
              <TableCell>
                <StatusBadge status={e.status} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {e.latency_ms} ms
              </TableCell>
              <TableCell>
                <TxLink hash={e.tx_hash} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
