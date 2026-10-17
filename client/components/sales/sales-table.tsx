"use client";

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
import { AddrLink, TxLink } from "@/components/tx-link";
import { clock, usdc } from "@/lib/format";
import { useFreshIds } from "@/lib/use-fresh";
import type { Sale } from "@/lib/types";

export function SalesTable({
  sales,
  loaded = true,
}: {
  sales: Sale[];
  /** False until the first fetch is done, so the first rows don't flash as "new". */
  loaded?: boolean;
}) {
  const isFresh = useFreshIds(loaded ? sales.map((r) => r.id) : undefined);
  if (!sales.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No settlements yet — this is the seller side of every paid call.
      </p>
    );
  }

  return (
    <>
      <RowCards label="Settlements" at="md">
        {sales.map((s) => (
          <RowCard
            key={s.id}
            flash={isFresh(s.id) ? "animate-flash-in" : undefined}
            title={s.seller}
            sub={clock(s.ts)}
            status={<StatusBadge status={s.status} />}
            amount={usdc(s.amount)}
            fields={[
              ["payer", <AddrLink key="p" address={s.payer} />],
              ["latency", `${s.latency_ms} ms`],
              ["tx", <TxLink key="t" hash={s.tx_hash} />],
            ]}
            notes={[s.reason]}
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
              <TableRow
                key={s.id}
                className={isFresh(s.id) ? "animate-flash-in" : undefined}
              >
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
    </>
  );
}
