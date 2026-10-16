"use client";

import { useEffect, useRef } from "react";

export function LiveLog({ lines }: { lines: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  return (
    <div className="h-72 overflow-y-auto rounded-xl border border-border bg-background/80 p-3 font-mono text-xs leading-relaxed">
      {lines.length ? (
        lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="select-none text-primary/60">›</span>
            <span className="whitespace-pre-wrap break-words text-muted-foreground">
              {line}
            </span>
          </div>
        ))
      ) : (
        <span className="text-muted-foreground">
          waiting for the agent to start…
        </span>
      )}
      <div ref={endRef} />
    </div>
  );
}
