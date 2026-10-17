"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared wall clocks for "12s ago" and elapsed timers, one interval per tick
 * rate however many components read it. Prerendering may not read the time, so
 * the server snapshot is 0: treat 0 as "not known yet".
 */
const clocks = new Map<number, { now: number; subscribe: (notify: () => void) => () => void }>();

function clock(everyMs: number) {
  let c = clocks.get(everyMs);
  if (!c) {
    const listeners = new Set<() => void>();
    let id: ReturnType<typeof setInterval> | undefined;
    const entry = {
      now: 0,
      subscribe(notify: () => void) {
        listeners.add(notify);
        if (listeners.size === 1) {
          const tick = () => {
            entry.now = Date.now();
            listeners.forEach((l) => l());
          };
          tick();
          id = setInterval(tick, everyMs);
        } else if (!entry.now) {
          entry.now = Date.now();
        }
        return () => {
          listeners.delete(notify);
          if (!listeners.size) clearInterval(id);
        };
      },
    };
    c = entry;
    clocks.set(everyMs, c);
  }
  return c;
}

export function useNow(everyMs = 1000) {
  const c = clock(everyMs);
  return useSyncExternalStore(c.subscribe, () => c.now, () => 0);
}

/** 3200 -> "3.2s", 75000 -> "1m 15s". */
export function elapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}
