"use client";

import { motion } from "motion/react";
import { ShieldAlertIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryBadge } from "@/components/status-badge";
import { AddrLink } from "@/components/tx-link";
import { ADVERSARIAL_IDS, pct, usdc } from "@/lib/format";
import type { Service } from "@/lib/types";

export function ServiceCard({
  service,
  index,
}: {
  service: Service;
  index: number;
}) {
  const adversarial = ADVERSARIAL_IDS.has(service.id);
  const rep = service.reputation;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.32) }}
      whileHover={{ y: -4 }}
      className="h-full"
    >
      <Card
        className={
          "h-full ring-1 transition-colors " +
          (adversarial
            ? "ring-bad/30 hover:ring-bad/50"
            : "ring-foreground/10 hover:ring-primary/40")
        }
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="font-mono text-sm font-medium">{service.name}</div>
            <CategoryBadge category={service.category} />
          </div>
          <div className="text-xs text-muted-foreground">
            {service.description || "No description."}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-2xl text-primary">
              {usdc(service.price)}
            </span>
            <span className="text-xs text-muted-foreground">USDC / call</span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>reputation</span>
              <span className="font-mono">
                {rep.attempts
                  ? `${pct(rep.successRate)} success · ${rep.successes}/${rep.attempts}`
                  : "new · no calls yet"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round(rep.score * 100)}%` }}
              />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <dt>method</dt>
            <dd className="text-foreground">{service.method}</dd>
            <dt>latency</dt>
            <dd className="text-foreground">
              {rep.medianLatencyMs ? `${rep.medianLatencyMs} ms` : "n/a"}
            </dd>
            <dt>payTo</dt>
            <dd className="text-foreground">
              <AddrLink address={service.payTo} />
            </dd>
            <dt>owner</dt>
            <dd className="text-foreground">{service.owner}</dd>
            <dt>network</dt>
            <dd className="text-foreground">{service.network}</dd>
          </dl>

          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {service.endpoint}
          </div>

          {adversarial ? (
            <div className="flex items-center gap-1.5 rounded-md border border-bad/30 bg-bad/10 px-2 py-1 text-[11px] text-bad">
              <ShieldAlertIcon className="size-3" />
              deliberately hostile seller — the buyer should route around it
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
