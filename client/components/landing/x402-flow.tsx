"use client";

import { motion } from "motion/react";
import {
  CheckCircle2Icon,
  LockIcon,
  PenLineIcon,
  SendIcon,
} from "lucide-react";
import { Reveal } from "./reveal";

const STEPS = [
  {
    icon: SendIcon,
    title: "Agent requests",
    body: "The buyer calls a seller's endpoint for one unit of work.",
  },
  {
    icon: LockIcon,
    title: "402 quote",
    body: "The seller answers 402 with a price, network and payTo address.",
  },
  {
    icon: PenLineIcon,
    title: "Agent authorises",
    body: "The buyer signs an EIP-3009 transferWithAuthorization — no gas, no approval.",
  },
  {
    icon: CheckCircle2Icon,
    title: "Work, then settle",
    body: "The seller verifies the signature, does the work, checks its output, and only then settles on Base Sepolia through the facilitator.",
  },
];

export function X402Flow() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <div className="mb-10 flex flex-col gap-2">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            how it works
          </span>
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
            One call, four moves
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            x402 turns an ordinary HTTP request into a paid one. Nothing is
            charged until the seller has delivered valid output.
          </p>
        </div>
      </Reveal>

      <div className="relative">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-7 hidden h-px bg-border md:block"
        >
          <motion.span
            className="absolute -top-1 size-2 rounded-full bg-primary shadow-[0_0_12px] shadow-primary"
            animate={{ left: ["0%", "100%"] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <ol className="grid gap-6 md:grid-cols-4">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08}>
              <li className="flex flex-col gap-3">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/25 bg-card ring-1 ring-primary/10">
                  <step.icon className="size-6 text-primary" />
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  0{i + 1}
                </div>
                <h3 className="font-heading text-base font-medium">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
