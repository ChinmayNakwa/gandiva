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
import { TxLink } from "@/components/tx-link";
import { short, usdc } from "@/lib/format";
import type { Purchase } from "@/lib/types";

export function ReceiptTable({ purchases }: { purchases: Purchase[] }) {
  if (!purchases.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No payments attempted yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Listed</TableHead>
            <TableHead className="text-right">Asked</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {purchases.map((p, i) => (
            <TableRow key={i}>
              <TableCell className="font-mono text-xs">{p.step}</TableCell>
              <TableCell>
                <div className="text-sm">{p.service}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {short(p.seller)}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
                {p.reason ? (
                  <div className="mt-1 max-w-[22rem] text-[11px] text-muted-foreground">
                    {p.reason}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {usdc(p.listed)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {p.asked ? usdc(p.asked) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-primary">
                {usdc(p.paid)}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {p.latencyMs} ms
              </TableCell>
              <TableCell>
                <TxLink hash={p.txHash} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
