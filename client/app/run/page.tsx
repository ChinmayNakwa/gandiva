"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AgentWalletCard } from "@/components/agent/agent-wallet-card";
import { PageIntro } from "@/components/page-intro";
import { Stat } from "@/components/stat";
import { TaskForm, type RunForm } from "@/components/run/task-form";
import { LiveLog } from "@/components/run/live-log";
import { ReceiptTable } from "@/components/run/receipt-table";
import { Explanation, QuoteView, ResultView } from "@/components/run/result-view";
import { startRun } from "@/lib/api";
import { EXAMPLE_TASKS } from "@/lib/examples";
import { useInfo, useRun } from "@/lib/hooks";
import { usdc } from "@/lib/format";
import type { RunStateName } from "@/lib/types";

const STATE_TONE: Record<RunStateName, string> = {
  running: "border-info/40 bg-info/10 text-info",
  completed: "border-ok/40 bg-ok/10 text-ok",
  partial: "border-warn/40 bg-warn/10 text-warn",
  needs_more_budget: "border-warn/40 bg-warn/10 text-warn",
  failed: "border-bad/40 bg-bad/10 text-bad",
};

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

  async function onStart() {
    setStarting(true);
    setError(null);
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
      />

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

      {run ? (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Run"
              value={run.id}
              hint={[run.dryRun ? "dry run" : "", run.mode === "legacy" ? "built-in books pipeline" : (run.planner ?? "")].filter(Boolean).join(" · ")}
            />
            <Stat
              label="State"
              value={
                <Badge
                  variant="outline"
                  className={"font-mono " + STATE_TONE[run.state]}
                >
                  {run.state.replace(/_/g, " ")}
                </Badge>
              }
            />
            <Stat label="Spent" value={`${usdc(run.spent)} USDC`} hint={`of ${usdc(run.budget)} budget`} />
            <Stat
              label="Remaining"
              value={`${usdc(run.remaining)} USDC`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agent log</CardTitle>
            </CardHeader>
            <CardContent>
              <LiveLog lines={run.log} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <ReceiptTable purchases={run.purchases} />
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

          {run.result && !run.dryRun ? (
            <Card>
              <CardHeader>
                <CardTitle>Result</CardTitle>
              </CardHeader>
              <CardContent>
                <ResultView run={run} />
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
