"use client";

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { transition } from "@/lib/motion";

export interface WizardStep {
  title: string;
  hint: string;
  content: ReactNode;
  /** Why the seller can't move past this step yet, or null when it's complete. */
  problem: string | null;
}

/**
 * A listing form split into steps, with a live preview beside it (below it on
 * phones). Enter moves to the next step; on the last step it submits. Steps
 * can be revisited freely and skipped ahead once everything before is filled.
 */
export function Wizard({
  steps,
  preview,
  submitLabel,
  submittingLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  steps: WizardStep[];
  preview: ReactNode;
  submitLabel: string;
  submittingLabel: string;
  submitting: boolean;
  error: string | null;
  /** Resolve true when saved, to start the next listing from step 1. */
  onSubmit: () => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [tried, setTried] = useState(-1);
  const navigated = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const last = steps.length - 1;
  const current = steps[step];
  const reachable = (i: number) => steps.slice(0, i).every((s) => !s.problem);

  function go(i: number) {
    if (i === step || i < 0 || i > last) return;
    if (i > step && !reachable(i)) {
      setTried(step);
      return;
    }
    navigated.current = true;
    setDirection(i > step ? 1 : -1);
    setTried(-1);
    setStep(i);
  }

  async function submit() {
    const blocked = steps.findIndex((s) => s.problem);
    if (blocked !== -1) {
      if (blocked !== step) go(blocked);
      setTried(blocked);
      return;
    }
    if (await onSubmit()) {
      setDirection(-1);
      setStep(0);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        noValidate
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting) return;
          if (step < last) go(step + 1);
          else void submit();
        }}
      >
        <ol className="flex items-center gap-2" aria-label="Steps">
          {steps.map((s, i) => {
            const done = i < step && !s.problem;
            const here = i === step;
            return (
              <li key={s.title} className={cn("flex items-center gap-2", i < last && "flex-1")}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={here ? "step" : undefined}
                  disabled={i > step && !reachable(i)}
                  className="group flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed"
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs transition-colors",
                      here
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground group-enabled:group-hover:border-primary/40",
                    )}
                  >
                    {done ? <CheckIcon className="size-3.5" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-xs whitespace-nowrap",
                      here ? "font-medium text-foreground" : "hidden text-muted-foreground sm:inline",
                    )}
                  >
                    {s.title}
                  </span>
                </button>
                {i < last ? (
                  <span aria-hidden className="relative h-px min-w-4 flex-1 bg-border">
                    <span
                      className="absolute inset-0 origin-left bg-primary transition-transform duration-500 ease-out-quint motion-reduce:transition-none"
                      style={{ transform: `scaleX(${i < step ? 1 : 0})` }}
                    />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div ref={panel} className="min-h-72">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ opacity: 0, x: 24 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction }}
              transition={transition.base}
              onAnimationComplete={(def) => {
                // After Next/Back, put the keyboard in the new step's first field
                // (on the entering panel, not the one leaving).
                const entered = typeof def === "object" && def !== null && "opacity" in def && def.opacity === 1;
                if (!entered || !navigated.current) return;
                navigated.current = false;
                panel.current
                  ?.querySelector<HTMLElement>("input:not([disabled]), select, textarea")
                  ?.focus({ preventScroll: true });
              }}
              className="flex flex-col gap-4"
            >
              <div>
                <h3 className="font-display text-2xl">{current.title}</h3>
                <p className="text-sm text-muted-foreground">{current.hint}</p>
              </div>
              {current.content}
            </motion.div>
          </AnimatePresence>
        </div>

        <div aria-live="polite">
          {tried === step && current.problem ? (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              {current.problem}
            </p>
          ) : error ? (
            <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => go(step - 1)} disabled={submitting}>
              <ArrowLeftIcon /> Back
            </Button>
          ) : null}
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          ) : null}
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            step {step + 1} of {steps.length}
          </span>
          <Button type="submit" disabled={submitting}>
            {step < last ? (
              <>
                Next <ArrowRightIcon />
              </>
            ) : submitting ? (
              submittingLabel
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </form>

      <aside aria-label="Live preview" className="min-w-0 lg:sticky lg:top-28 lg:self-start">
        {preview}
      </aside>
    </div>
  );
}
