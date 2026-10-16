"use client";

import { PlayIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EXAMPLE_TASKS } from "@/lib/examples";

export interface RunForm {
  task: string;
  budget: string;
  maxConcurrency: number;
  dryRun: boolean;
  token: string;
}

export function TaskForm({
  value,
  onChange,
  onSubmit,
  running,
  canStart,
  tokenRequired,
}: {
  value: RunForm;
  onChange: (next: RunForm) => void;
  onSubmit: () => void;
  running: boolean;
  canStart: boolean;
  tokenRequired: boolean;
}) {
  const set = (patch: Partial<RunForm>) => onChange({ ...value, ...patch });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canStart && !running) onSubmit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task" className="text-xs text-muted-foreground">
          Task
        </Label>
        <textarea
          id="task"
          value={value.task}
          onChange={(e) => set({ task: e.target.value })}
          rows={3}
          className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          placeholder="Describe the job for the buyer agent…"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLE_TASKS.map((t, i) => (
          <Button
            key={i}
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal text-left text-xs"
            onClick={() => set({ task: t })}
          >
            {i + 1}. {t.replace(/^From /, "").slice(0, 42)}…
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budget" className="text-xs text-muted-foreground">
            Budget (USDC)
          </Label>
          <Input
            id="budget"
            inputMode="decimal"
            className="font-mono"
            value={value.budget}
            onChange={(e) => set({ budget: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conc" className="text-xs text-muted-foreground">
            Max concurrency
          </Label>
          <Input
            id="conc"
            type="number"
            min={1}
            max={10}
            className="font-mono"
            value={value.maxConcurrency}
            onChange={(e) =>
              set({ maxConcurrency: Number(e.target.value) || 1 })
            }
          />
        </div>
        {tokenRequired ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token" className="text-xs text-muted-foreground">
              Buyer token
            </Label>
            <Input
              id="token"
              type="password"
              className="font-mono"
              value={value.token}
              onChange={(e) => set({ token: e.target.value })}
              placeholder="x-buyer-token"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="dry"
          size="sm"
          checked={value.dryRun}
          onCheckedChange={(checked) => set({ dryRun: checked })}
        />
        <Label htmlFor="dry" className="text-xs text-muted-foreground">
          Dry run: plan and quote the cost, pay nothing
        </Label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canStart || running}>
          {running ? (
            <>
              <SquareIcon className="size-4" /> Running…
            </>
          ) : (
            <>
              <PlayIcon className="size-4" /> {value.dryRun ? "Get quote" : "Start run"}
            </>
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          The buyer pays each seller per call: from your agent wallet when you are signed in, otherwise from the shared demo wallet.
        </span>
      </div>
    </form>
  );
}
