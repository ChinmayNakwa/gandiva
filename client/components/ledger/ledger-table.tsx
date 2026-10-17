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
import type { LedgerEntry } from "@/lib/types";

export function LedgerTable({
  entries,
  loaded = true,
}: {
  entries: LedgerEntry[];
  /** False until the first fetch is done, so the first rows don't flash as "new". */
  loaded?: boolean;
}) {
  const isFresh = useFreshIds(loaded ? entries.map((r) => r.id) : undefined);
  if (!entries.length) {
    return (
      <p className="rounded-xl border border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No ledger entries yet — run a task to see the buyer&apos;s spending.
      </p>
    );
  }

  return (
    <>
      <RowCards label="Ledger entries" at="lg">
        {entries.map((e) => (
          <RowCard
            key={e.id}
            flash={isFresh(e.id) ? "animate-flash-in" : undefined}
            title={e.service_name}
            sub={`${clock(e.ts)} · run ${e.run_id ?? "—"}`}
            status={<StatusBadge status={e.status} />}
            amount={usdc(e.paid)}
            fields={[
              ["listed", usdc(e.listed)],
              ["asked", e.asked != null ? usdc(e.asked) : "—"],
              ["latency", `${e.latency_ms} ms`],
              ["buyer", <AddrLink key="b" address={e.buyer} />],
              ["seller", <AddrLink key="s" address={e.seller} />],
              ["tx", <TxLink key="t" hash={e.tx_hash} />],
            ]}
            notes={[e.reason]}
          />
        ))}
      </RowCards>
      <div
        className={
          "overflow-x-auto rounded-xl border border-border " + WIDE.lg.table
        }
      >
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
              <TableRow
                key={e.id}
                className={isFresh(e.id) ? "animate-flash-in" : undefined}
              >
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
                <TableCell className="min-w-[12rem]">
                  <div className="text-sm">{e.service_name}</div>
                  {e.reason ? (
                    <div className="max-w-[20rem] whitespace-normal text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
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
    </>
  );
}
