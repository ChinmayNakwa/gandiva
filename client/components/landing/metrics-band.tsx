"use client";

import { useInfo, useLedger, useServices } from "@/lib/hooks";
import { Counter } from "./counter";
import { Reveal } from "./reveal";

export function MetricsBand() {
  const { data: services } = useServices();
  const { data: ledger } = useLedger();
  const { data: info } = useInfo();

  const entries = ledger?.entries ?? [];
  const paid = entries.filter((e) => e.status === "paid");
  const latencies = paid
    .map((e) => e.latency_ms)
    .sort((a, b) => a - b);
  const medianLatency = latencies.length
    ? latencies[Math.floor(latencies.length / 2)]
    : 0;

  const volume = Number(ledger?.totalPaid ?? "0") / 1e6;

  const METRICS = [
    {
      label: "services listed",
      value: <Counter value={services?.services.length ?? 0} />,
    },
    {
      label: "settled volume (USDC)",
      value: <Counter value={volume} decimals={4} />,
    },
    {
      label: "payments settled",
      value: <Counter value={paid.length} />,
    },
    {
      label: "median latency (ms)",
      value: <Counter value={medianLatency} />,
    },
    {
      label: "sellers",
      value: <Counter value={info?.sellers.length ?? 0} />,
    },
  ];

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {METRICS.map((m) => (
            <div
              key={m.label}
              className="flex flex-col gap-1 bg-card px-5 py-6"
            >
              <div className="font-mono text-3xl text-primary">{m.value}</div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
