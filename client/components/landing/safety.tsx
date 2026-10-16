"use client";

import {
  EyeOffIcon,
  PackageCheckIcon,
  RepeatIcon,
  ScaleIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "lucide-react";
import { Reveal } from "./reveal";

const RULES = [
  {
    icon: WalletIcon,
    title: "Hard budget cap",
    body: "Every run carries a USDC budget. The agent buys while calls fit and stops the moment they don't — it cannot overspend.",
  },
  {
    icon: ScaleIcon,
    title: "Price must match",
    body: "The 402 challenge must ask no more than the listed price, in the listed token, on the listed network, to the listed payTo. Anything else is refused before signing.",
  },
  {
    icon: PackageCheckIcon,
    title: "No service, no charge",
    body: "Sellers verify the payment, do the work and check their own output first. Settlement only happens after valid output, so a failed call costs nothing.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Reputation failover",
    body: "Sellers are ranked by a reputation score computed from the ledger. Junk output drops that seller's score and the agent buys from the next one.",
  },
  {
    icon: RepeatIcon,
    title: "Replay protection",
    body: "Each EIP-3009 authorisation nonce is claimed once by the seller before verifying. A copied signature, sequential or parallel, gets 409 and never settles twice.",
  },
  {
    icon: EyeOffIcon,
    title: "No blind trust",
    body: "A call can settle and still fail inspection. Paid-but-rejected is recorded on the ledger, so buyers learn who to avoid.",
  },
];

export function Safety() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <div className="mb-10 flex flex-col gap-2">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            safety & rules
          </span>
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
            Pay per call, not on faith
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The demo registry ships deliberately hostile sellers. The
            buyer&apos;s rules are what keep a broken or dishonest service from
            costing real money.
          </p>
        </div>
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RULES.map((rule, i) => (
          <Reveal key={rule.title} delay={i * 0.06}>
            <div className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card/50 p-5">
              <rule.icon className="size-5 text-primary" />
              <h3 className="font-heading text-base font-medium">
                {rule.title}
              </h3>
              <p className="text-sm text-muted-foreground">{rule.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
