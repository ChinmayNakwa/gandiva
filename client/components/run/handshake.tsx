"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { TxLink } from "@/components/tx-link";
import { elapsed, useNow } from "@/lib/clock";
import { statusLabel, usdc } from "@/lib/format";
import { duration, ease, spring, transition } from "@/lib/motion";
import type { CallPhase, InflightCall, Purchase, Run } from "@/lib/types";

const STEPS = [
  { label: "Request", hint: "call the seller" },
  { label: "402 quote", hint: "checked vs listing" },
  { label: "Sign", hint: "EIP-3009, no gas" },
  { label: "Settle", hint: "on Base Sepolia" },
  { label: "Receipt", hint: "output checked" },
] as const;

/** Which step is in progress during each live phase. */
const ACTIVE: Record<CallPhase, number> = { requesting: 0, quoted: 2, settling: 3 };

/** How long a finished call stays on screen before it hands over to the receipts table. */
const LINGER_MS = 3500;
/** After this long settling, say that the chain is slow rather than leave a silent wait. */
const SLOW_SETTLE_MS = 8000;

type StepState = "done" | "active" | "todo" | "failed" | "warn";

// Stable empty list: a fresh [] each render would look like a change every time.
const NONE: InflightCall[] = [];

interface Finished {
  call: InflightCall;
  outcome?: Purchase;
  until: number;
}

function liveSteps(phase: CallPhase): StepState[] {
  const a = ACTIVE[phase];
  return STEPS.map((_, i) => (i < a ? "done" : i === a ? "active" : "todo"));
}

/** Where a finished call ended up, from its last live phase and its receipt. */
function finishedSteps(last: CallPhase, p?: Purchase): StepState[] {
  const upTo = (n: number, end: StepState): StepState[] =>
    STEPS.map((_, i) => (i < n ? "done" : i === n ? end : "todo"));
  if (!p) return upTo(ACTIVE[last], "failed");
  switch (p.status) {
    case "paid":
      return STEPS.map(() => "done");
    case "paid_output_rejected":
      return upTo(4, "warn");
    case "unconfirmed":
      return upTo(3, "warn");
    default: {
      // Refused or not charged: mark the step where it stopped.
      if (last === "settling") return upTo(3, "failed");
      if (last === "quoted") return upTo(2, "failed");
      return upTo(p.status === "refused" ? 1 : 0, "failed");
    }
  }
}

function caption(call: InflightCall, phaseMs: number): string {
  switch (call.phase) {
    case "requesting":
      return `Calling ${call.service}, waiting for its price (HTTP 402)…`;
    case "quoted":
      return `402 accepted: ${usdc(call.asked)} USDC matches the listing. Signing the payment…`;
    case "settling":
      return phaseMs > SLOW_SETTLE_MS
        ? "Still settling. Testnet blocks can be slow; nothing is marked paid until the settlement comes back."
        : "Signed. The seller is verifying, doing the work and settling on Base Sepolia…";
  }
}

/**
 * Live view of every paid call in a run: each one walks Request → 402 quote →
 * Sign → Settle → Receipt as the server reports it, then lingers briefly with
 * its outcome before the receipts table takes over.
 */
export function Handshake({ run }: { run: Run }) {
  const inflight = run.inflight ?? NONE;
  const now = useNow(200);

  // Spot calls that just finished by comparing with the previous poll. Done
  // during render (React's "adjust state on prop change" pattern), so the
  // finished card appears in the same frame the live one disappears.
  const [prev, setPrev] = useState<InflightCall[]>(inflight);
  const [finished, setFinished] = useState<Finished[]>([]);
  if (inflight !== prev) {
    const gone = prev.filter((p) => !inflight.some((c) => c.id === p.id));
    if (gone.length) {
      const used = new Set(finished.map((f) => f.outcome));
      const added = gone.map((call) => {
        const outcome = [...run.purchases]
          .reverse()
          .find((p) => p.step === call.step && p.serviceId === call.serviceId && !used.has(p));
        if (outcome) used.add(outcome);
        return { call, outcome, until: now + LINGER_MS };
      });
      setFinished([...finished, ...added]);
    }
    setPrev(inflight);
  }

  useEffect(() => {
    if (!finished.length) return;
    const next = Math.min(...finished.map((f) => f.until));
    const t = setTimeout(
      () => setFinished((f) => f.filter((x) => x.until > Date.now())),
      Math.max(50, next - Date.now()),
    );
    return () => clearTimeout(t);
  }, [finished]);

  const running = run.state === "running";
  if (!running && !inflight.length && !finished.length) return null;

  const cards = [
    ...finished.map((f) => ({ key: `${f.call.id}`, call: f.call, outcome: f.outcome, done: true as const })),
    ...inflight.map((call) => ({ key: `${call.id}`, call, outcome: undefined, done: false as const })),
  ].sort((a, b) => a.call.id - b.call.id);

  return (
    <section aria-label="Live payments" className="flex flex-col gap-3">
      {/* Screen readers get phase changes, not every timer tick. */}
      <p className="sr-only" aria-live="polite">
        {inflight.map((c) => `${c.service}: ${STEPS[ACTIVE[c.phase]].label}`).join(". ")}
      </p>

      <AnimatePresence initial={false} mode="popLayout">
        {cards.map(({ key, call, outcome, done }) => {
          const steps = done ? finishedSteps(call.phase, outcome) : liveSteps(call.phase);
          const total = now ? now - Date.parse(call.startedAt) : 0;
          const phaseMs = now ? now - Date.parse(call.phaseAt) : 0;
          const amount = outcome?.paid && outcome.paid !== "0" ? outcome.paid : call.asked;
          return (
            <motion.article
              key={key}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={transition.base}
              className={cn(
                "rounded-2xl border bg-card p-4 sm:p-5",
                done
                  ? outcome?.status === "paid"
                    ? "border-ok/40"
                    : "border-border"
                  : "border-primary/30 shadow-[0_0_0_4px] shadow-primary/5",
              )}
            >
              <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{call.service}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{call.step}</span>
                </div>
                <div className="flex items-baseline gap-3 font-mono text-xs">
                  {amount ? <span className="text-primary">{usdc(amount)} USDC</span> : null}
                  <span className="text-muted-foreground tabular-nums">
                    {done ? (outcome ? `${outcome.latencyMs} ms` : "") : now ? elapsed(total) : "…"}
                  </span>
                </div>
              </header>

              <Steps steps={steps} />

              <div className="mt-4 min-h-5 text-xs">
                {done ? (
                  outcome?.status === "paid" ? (
                    <span className="inline-flex flex-wrap items-center gap-2 text-ok">
                      Settled and verified · <TxLink hash={outcome.txHash} />
                    </span>
                  ) : (
                    <span className={outcome?.status === "unconfirmed" || outcome?.status === "paid_output_rejected" ? "text-warn" : "text-bad"}>
                      {outcome ? statusLabel(outcome.status) : "stopped"}
                      {outcome?.reason ? ` · ${outcome.reason}` : ""}
                    </span>
                  )
                ) : (
                  <span className={phaseMs > SLOW_SETTLE_MS && call.phase === "settling" ? "text-warn" : "text-muted-foreground"}>
                    {caption(call, phaseMs)}
                    {call.phase === "settling" && now ? (
                      <span className="ml-1 font-mono tabular-nums">{elapsed(phaseMs)}</span>
                    ) : null}
                  </span>
                )}
              </div>
            </motion.article>
          );
        })}
      </AnimatePresence>

      {running && !cards.length ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          No payment in flight. The agent is planning its next move…
        </p>
      ) : null}
    </section>
  );
}

function Steps({ steps }: { steps: StepState[] }) {
  return (
    <ol className="flex items-start">
      {STEPS.map((step, i) => {
        const state = steps[i];
        const last = i === STEPS.length - 1;
        return (
          <li key={step.label} className={cn("flex items-start", !last && "flex-1")}>
            <div className="flex w-14 flex-col items-center gap-1.5 text-center sm:w-20">
              <Node state={state} index={i} />
              <span
                className={cn(
                  "text-[11px] leading-tight sm:text-xs",
                  state === "todo" ? "text-muted-foreground" : "text-foreground",
                  state === "failed" && "text-bad",
                  state === "warn" && "text-warn",
                )}
              >
                {step.label}
              </span>
              <span className="hidden text-[10px] leading-tight text-muted-foreground sm:block">{step.hint}</span>
            </div>
            {!last ? <Connector filled={state === "done"} moving={steps[i + 1] === "active"} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Node({ state, index }: { state: StepState; index: number }) {
  return (
    <span className="relative flex size-7 items-center justify-center">
      {state === "active" ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/25"
          animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <motion.span
        key={state}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring.snappy}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-full border font-mono text-[11px]",
          state === "done" && "border-primary bg-primary text-primary-foreground",
          state === "active" && "border-primary bg-card text-primary",
          state === "todo" && "border-border bg-card text-muted-foreground",
          state === "failed" && "border-bad bg-bad text-primary-foreground",
          state === "warn" && "border-warn bg-warn text-primary-foreground",
        )}
      >
        {state === "done" ? (
          <CheckIcon className="size-3.5" strokeWidth={3} />
        ) : state === "failed" ? (
          <XIcon className="size-3.5" strokeWidth={3} />
        ) : state === "warn" ? (
          <AlertTriangleIcon className="size-3.5" strokeWidth={2.5} />
        ) : (
          index + 1
        )}
      </motion.span>
    </span>
  );
}

/** The line between two steps: fills when the step is done; an arrow travels it while the next step is in progress. */
function Connector({ filled, moving }: { filled: boolean; moving: boolean }) {
  return (
    <div aria-hidden className="relative mt-3.5 h-px flex-1 bg-border">
      <motion.span
        className="absolute inset-0 origin-left bg-primary"
        initial={false}
        animate={{ scaleX: filled ? 1 : 0 }}
        transition={{ duration: duration.slow, ease: ease.out }}
      />
      {moving ? (
        <motion.span
          className="absolute inset-0"
          initial={{ x: "0%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 1.1, repeat: Infinity, ease: ease.inOut }}
        >
          <svg viewBox="0 0 10 10" className="absolute -top-1.25 -left-2.5 size-2.5 text-primary" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 1.5 L8 5 L2 8.5" />
          </svg>
        </motion.span>
      ) : null}
    </div>
  );
}
