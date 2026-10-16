"use client";

import { AnimatePresence, motion } from "motion/react";
import { ActivityIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { useLedger } from "@/lib/hooks";
import { clock, usdc } from "@/lib/format";
import { Reveal } from "./reveal";

export function LiveFeed() {
  const { data } = useLedger();
  const entries = (data?.entries ?? []).slice(0, 6);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              live ledger
            </span>
            <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
              Payments, as they happen
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              The buyer-side ledger records every attempt — clean payments,
              junk output we refused to trust, and calls that failed before any
              money moved.
            </p>
          </div>
          <div className="font-mono text-sm text-muted-foreground">
            total paid{" "}
            <span className="text-primary">
              {usdc(data?.totalPaid)} USDC
            </span>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <Card>
          <CardContent className="pt-1">
            <div className="mb-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <ActivityIcon className="size-3.5 text-primary" />
              /registry/ledger
            </div>

            {entries.length ? (
              <ul className="flex flex-col divide-y divide-border">
                <AnimatePresence initial={false}>
                  {entries.map((e) => (
                    <motion.li
                      key={e.id}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 py-2.5 font-mono text-xs sm:gap-4"
                    >
                      <span className="text-muted-foreground">
                        {clock(e.ts)}
                      </span>
                      <span className="truncate text-foreground">
                        {e.service_name}
                        <span className="ml-2 text-muted-foreground">
                          {e.run_id ? `run ${e.run_id}` : ""}
                        </span>
                      </span>
                      <StatusBadge status={e.status} />
                      <span className="text-right text-primary">
                        {usdc(e.paid)}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No payments yet — run a task from the dashboard to populate the
                ledger.
              </p>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </section>
  );
}
