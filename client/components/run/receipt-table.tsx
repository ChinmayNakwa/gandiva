"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RowCard, RowCards, WIDE } from "@/components/row-cards";
import { StatusBadge } from "@/components/status-badge";
import { TxLink } from "@/components/tx-link";
import { short, usdc } from "@/lib/format";
import type { Purchase } from "@/lib/types";

export function ReceiptTable({ purchases }: { purchases: Purchase[] }) {
  // Receipts already there on mount appear as-is; new ones flash in once.
  const [fresh] = useState(purchases.length);

  if (!purchases.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
        No payments attempted yet.
      </p>
    );
  }

  return (
    <>
      <RowCards label="Receipts" at="md">
        {purchases.map((p, i) => (
          <RowCard
            key={i}
            flash={i >= fresh ? "animate-receipt-in" : undefined}
            title={p.service}
            sub={p.step}
            status={<StatusBadge status={p.status} />}
            amount={usdc(p.paid)}
            fields={[
              ["listed", usdc(p.listed)],
              ["asked", p.asked ? usdc(p.asked) : "—"],
              ["latency", `${p.latencyMs} ms`],
              ["seller", short(p.seller)],
              ["tx", <TxLink key="t" hash={p.txHash} />],
            ]}
            notes={[p.reason, p.why ? `Why chosen: ${p.why}` : null]}
          />
        ))}
      </RowCards>
      <div
        className={
          "overflow-x-auto rounded-xl border border-border " + WIDE.md.table
        }
      >
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
              <TableHead>Why chosen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.map((p, i) => (
              <TableRow
                key={i}
                className={i >= fresh ? "animate-receipt-in" : undefined}
              >
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
                    <div className="mt-1 max-w-[22rem] whitespace-normal text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
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
                <TableCell className="min-w-[14rem] max-w-[22rem] whitespace-normal text-[11px] text-muted-foreground">
                  {p.why}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
