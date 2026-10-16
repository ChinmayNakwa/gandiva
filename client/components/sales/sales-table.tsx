"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddrLink, TxLink } from "@/components/tx-link";
import { clock, statusLabel, usdc } from "@/lib/format";
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
              <TableCell>
                <AddrLink address={s.seller} />
              </TableCell>
              <TableCell>
                <AddrLink address={s.payer} />
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-primary">
                {usdc(s.amount)} USDC
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {statusLabel(s.status)}
                {s.reason ? ` — ${s.reason}` : ""}
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
