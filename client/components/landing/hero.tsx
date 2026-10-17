"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroTitle } from "./hero-title";
import { LiveTicker } from "./live-ticker";

/**
 * Entrance for the n-th hero block: CSS, so it runs from the first paint rather
 * than after hydration (this copy is the page's largest paint). Same rhythm as
 * the old motion stagger: 0.05s, then 0.08s apart.
 */
const RISE = "animate-rise-in motion-reduce:animate-none";
const rise = (n: number) => ({ animationDelay: `${0.05 + n * 0.08}s` });

const LINES = [
  { t: "$ npm run task -- \"cheapest 5-star books, pages 1→4\" 0.05 3", c: "text-foreground" },
  { t: "GET /sellers/shelf-scraper/scrape?page=1", c: "text-muted-foreground" },
  { t: "402 Payment Required · 0.005 USDC → payTo 0xf8ec…dFa1", c: "text-info" },
  { t: "check price, token, network, payTo · reserve budget", c: "text-muted-foreground" },
  { t: "→ sign transferWithAuthorization (EIP-3009)", c: "text-muted-foreground" },
  { t: "← 200 OK · 20 books · PAYMENT-RESPONSE tx 0x…", c: "text-ok" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Static warm glow and paper grid: no filters or looping motion, so it
          costs nothing on weak GPUs. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(40rem_28rem_at_30%_-10%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_70%),radial-gradient(32rem_24rem_at_85%_0%,color-mix(in_oklch,var(--gold)_18%,transparent),transparent_70%)]"
      >
        <div className="absolute inset-0 grid-backdrop opacity-25 mask-[radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 sm:py-28 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div className="flex flex-col items-start">
          <span
            style={rise(0)}
            className={`${RISE} rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-primary`}
          >
            x402 v2 · Base Sepolia · USDC
          </span>

          <HeroTitle />

          <p
            style={rise(1)}
            className={`${RISE} mt-5 max-w-xl text-base text-muted-foreground`}
          >
            Gandiva is a registry of paid services and a buyer agent that hires
            them. Every request is quoted with an HTTP&nbsp;402, paid in USDC
            through a facilitator, and settled on-chain — with a receipt for
            each call.
          </p>

          <div style={rise(2)} className={`${RISE} mt-8 flex flex-wrap gap-3`}>
            <Button asChild size="lg">
              <Link href="/marketplace">
                Open the dashboard <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/run">Run a task</Link>
            </Button>
          </div>

          <div style={rise(3)} className={`${RISE} mt-8`}>
            <LiveTicker />
          </div>
        </div>

        <div
          style={rise(4)}
          className={`${RISE} w-full rounded-2xl border border-border bg-background/70 p-4 shadow-2xl shadow-primary/5 ring-1 ring-primary/10 backdrop-blur`}
        >
          <div className="mb-3 flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-bad/70" />
            <span className="size-2.5 rounded-full bg-warn/70" />
            <span className="size-2.5 rounded-full bg-ok/70" />
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
              buyer agent — example trace
            </span>
          </div>
          <div className="flex flex-col gap-1.5 font-mono text-[12px] leading-relaxed">
            {LINES.map((line, i) => (
              <div
                key={i}
                style={{ animationDelay: `${0.5 + i * 0.18}s` }}
                className={`animate-slide-in motion-reduce:animate-none ${line.c}`}
              >
                {line.t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
