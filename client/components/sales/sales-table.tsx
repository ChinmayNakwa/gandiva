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
import type { Sale } from "@/lib/types";

export function SalesTable({ sales }: { sales: Sale[] }) {
  if (!sales.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No settlements yet — this is the seller side of every paid call.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Payer</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {clock(s.ts)}
              </TableCell>
              <TableCell className="font-mono text-xs">{s.seller}</TableCell>
              <TableCell>
                <AddrLink address={s.payer} />
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-primary">
                {usdc(s.amount)} USDC
              </TableCell>
              <TableCell>
                <StatusBadge status={s.status} />
                {s.reason ? (
                  <div className="mt-1 max-w-[22rem] text-[11px] text-muted-foreground">
                    {s.reason}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {s.latency_ms} ms
              </TableCell>
              <TableCell>
                <TxLink hash={s.tx_hash} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
