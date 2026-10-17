"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";

/** Colour a log line by what it reports, so payments and problems stand out. */
function tone(line: string): string {
  if (/-> paid\b|final answer|^\S+ done: completed/.test(line)) return "text-ok";
  if (/-> (refused|failed|replay)|fatal|rejected|could not/.test(line)) return "text-bad";
  if (/warning|stopped|unconfirmed|unknown|retrying|spend cap/.test(line)) return "text-warn";
  if (/^\S+ (plan|turn \d+: tool)/.test(line)) return "text-foreground";
  return "text-muted-foreground";
}

export function LiveLog({ lines }: { lines: string[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const seen = useRef(lines.length);

  // Follow new lines, but only while the reader is at the bottom; scroll the
  // box itself, never the page.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (nearBottom || seen.current === 0) box.scrollTop = box.scrollHeight;
    seen.current = lines.length;
  }, [lines.length]);

  // Lines already there on mount appear as-is; later ones slide in (each row
  // animates once, when it mounts).
  const [fresh] = useState(lines.length);

  return (
    <div
      ref={boxRef}
      data-lenis-prevent
      className="h-72 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background/80 p-3 font-mono text-xs leading-relaxed"
    >
      {lines.length ? (
        lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2",
              i >= fresh && "animate-in fade-in slide-in-from-bottom-1 duration-300",
            )}
          >
            <span className="select-none text-primary/60">›</span>
            <span className={cn("whitespace-pre-wrap wrap-break-word", tone(line))}>{line}</span>
          </div>
        ))
      ) : (
        <span className="text-muted-foreground">waiting for the agent to start…</span>
      )}
    </div>
  );
}
