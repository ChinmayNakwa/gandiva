"use client";

import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentWalletCard } from "@/components/agent/agent-wallet-card";
import { PageIntro } from "@/components/page-intro";
import { TaskForm, type RunForm } from "@/components/run/task-form";
import { Handshake } from "@/components/run/handshake";
import { LiveLog } from "@/components/run/live-log";
import { ReceiptTable } from "@/components/run/receipt-table";
import { RunStatus } from "@/components/run/run-status";
import { SoundToggle } from "@/components/run/sound-toggle";
import { usePaymentNotices } from "@/components/run/use-payment-notices";
import { Explanation, QuoteView, ResultView } from "@/components/run/result-view";
import { startRun } from "@/lib/api";
import { EXAMPLE_TASKS } from "@/lib/examples";
import { useInfo, useRun } from "@/lib/hooks";
import { getLenis } from "@/lib/scroll";

/** Bring the live view into sight once a run starts, so nobody has to hunt for it. */
function reveal(el: HTMLElement | null) {
  if (!el) return;
  const lenis = getLenis();
  // Both paths honour the marker's scroll-margin (clears the sticky header).
  // Lenis caches the page height; the page just grew, so re-measure first or
  // the scroll is clamped to the old (unscrollable) length.
  if (lenis) {
    lenis.resize();
    lenis.scrollTo(el);
  }
  else el.scrollIntoView({ block: "start" });
}

export default function RunPage() {
  const { data: info } = useInfo();
  const [form, setForm] = useState<RunForm>({
    task: EXAMPLE_TASKS[0],
    budget: "0.05",
    maxConcurrency: 3,
    dryRun: false,
    token: "",
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: run } = useRun(runId);
  const running = starting || run?.state === "running";
  const liveRef = useRef<HTMLDivElement>(null);
  usePaymentNotices(run);

  async function onStart() {
    setStarting(true);
    setError(null);
    // Wait a frame so the "starting" placeholder exists before scrolling to it.
    requestAnimationFrame(() => reveal(liveRef.current));
    try {
      const { runId: id } = await startRun({
        task: form.task,
        budget: form.budget,
        maxConcurrency: form.maxConcurrency,
        dryRun: form.dryRun,
        token: form.token,
      });
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start run.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <PageIntro
        eyebrow="buyer agent"
        title="Run a task"
        description="Give the agent a job and a budget. It plans the work, discovers sellers in the registry, pays each one per call over x402, falls back when a seller misbehaves, and returns results with a full receipt trail."
      >
        <div className="mt-2">
          <SoundToggle />
        </div>
      </PageIntro>

      <div className="mb-6">
        <AgentWalletCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New run</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm
            value={form}
            onChange={setForm}
            onSubmit={onStart}
            running={running}
            canStart={form.task.trim().length > 0 && form.budget.trim().length > 0}
            tokenRequired={info?.buyerTokenRequired ?? false}
          />
          {error ? (
            <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div ref={liveRef} className="scroll-mt-28" />

      {starting && !run ? (
        <div className="mt-6 animate-pulse rounded-2xl border border-border bg-card p-6">
          <div className="font-mono text-[11px] text-muted-foreground">new run</div>
          <p className="mt-2 font-display text-3xl sm:text-4xl">Starting the agent…</p>
          <div className="mt-5 h-1.5 rounded-full bg-muted" />
        </div>
      ) : null}

      {run ? (
        <div key={run.id} className="mt-6 flex flex-col gap-6">
          <RunStatus run={run} />

          <Handshake run={run} />

          {run.result && !run.dryRun ? (
            <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <CardHeader>
                <CardTitle>Result</CardTitle>
              </CardHeader>
              <CardContent>
                <ResultView run={run} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Payment receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptTable purchases={run.purchases} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent log</CardTitle>
            </CardHeader>
            <CardContent>
              <LiveLog lines={run.log} />
            </CardContent>
          </Card>

          {run.quote ? (
            <Card>
              <CardHeader>
                <CardTitle>Quote (dry run, nothing paid)</CardTitle>
              </CardHeader>
              <CardContent>
                <QuoteView quote={run.quote} budget={run.budget} />
              </CardContent>
            </Card>
          ) : null}

          {run.explanation ? (
            <Card>
              <CardHeader>
                <CardTitle>Why these calls</CardTitle>
              </CardHeader>
              <CardContent>
                <Explanation text={run.explanation} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
