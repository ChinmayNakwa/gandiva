"use client";

import { useId, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeftIcon, SearchIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "cn";
import { ADVERSARIAL_IDS, pct, usdc } from "@/lib/format";
import { transition } from "@/lib/motion";
import type { Service } from "@/lib/types";

/** Best matches first: name or id prefix, then name or id, then the rest of the listing. */
function rank(services: Service[], query: string): Service[] {
  const q = query.trim().toLowerCase();
  if (!q) return services;
  const scored: [number, Service][] = [];
  for (const s of services) {
    const name = `${s.name} ${s.id}`.toLowerCase();
    const rest = `${s.category} ${s.owner} ${s.description}`.toLowerCase();
    const score = s.name.toLowerCase().startsWith(q) || s.id.startsWith(q)
      ? 3
      : name.includes(q)
        ? 2
        : rest.includes(q)
          ? 1
          : 0;
    if (score) scored.push([score, s]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, s]) => s);
}

/**
 * ⌘K service search. Picking a result closes the dialog and hands the service
 * to `onPick` once focus has left the dialog, so the page can scroll to it.
 */
export function ServiceSearch({
  open,
  onOpenChange,
  services,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: Service[];
  onPick: (service: Service) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const picked = useRef<Service | null>(null);
  const listId = useId();
  const results = rank(services, query);
  const current = Math.min(active, Math.max(results.length - 1, 0));

  // Start fresh each time it opens (the page opens it directly on ⌘K).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
    }
  }

  function pick(s: Service | undefined) {
    if (!s) return;
    picked.current = s;
    onOpenChange(false);
  }

  function move(by: number) {
    if (!results.length) return;
    const next = (current + by + results.length) % results.length;
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition.base}
                className="fixed inset-0 z-60 bg-foreground/20 backdrop-blur-[2px]"
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                const s = picked.current;
                if (!s) return;
                picked.current = null;
                e.preventDefault();
                onPick(s);
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={transition.base}
                className="fixed inset-x-4 top-[12vh] z-60 mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
              >
                <Dialog.Title className="sr-only">Search services</Dialog.Title>
                <div className="flex items-center gap-3 border-b border-border px-4">
                  <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    autoFocus
                    role="combobox"
                    aria-expanded
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={results.length ? `${listId}-${current}` : undefined}
                    placeholder="Search by name, category, owner…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") move(1);
                      else if (e.key === "ArrowUp") move(-1);
                      else if (e.key === "Enter") pick(results[current]);
                      else return;
                      e.preventDefault();
                    }}
                    className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                    esc
                  </kbd>
                </div>

                <ul id={listId} role="listbox" aria-label="Services" className="flex-1 overflow-y-auto p-2">
                  {results.map((s, i) => (
                    <li
                      key={s.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === current}
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(s)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
                        i === current && "bg-muted",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm">{s.name}</span>
                          {ADVERSARIAL_IDS.has(s.id) || s.verification === "mismatch" ? (
                            <ShieldAlertIcon className="size-3.5 shrink-0 text-bad" aria-label="untrusted" />
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.category} · {s.owner} ·{" "}
                          {s.reputation.attempts ? `${pct(s.reputation.successRate)} success` : "no calls yet"}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-primary">{usdc(s.price)} USDC</span>
                      {i === current ? (
                        <CornerDownLeftIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!results.length ? (
                  <p className="px-4 pb-8 text-center text-sm text-muted-foreground">
                    Nothing listed matches “{query.trim()}”.
                  </p>
                ) : null}

                <div className="flex gap-4 border-t border-border px-4 py-2 font-mono text-[10px] text-muted-foreground">
                  <span>↑↓ move</span>
                  <span>↵ open</span>
                  <span className="ml-auto">{results.length} of {services.length}</span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
