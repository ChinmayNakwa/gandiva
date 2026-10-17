"use client";

import { useRef, type ComponentType } from "react";
import { motion } from "motion/react";
import {
  ArrowDownIcon,
  BotIcon,
  CheckCircle2Icon,
  LockIcon,
  PenLineIcon,
  SendIcon,
  StoreIcon,
} from "lucide-react";
import { useGsap } from "@/lib/gsap";
import { getLenis } from "@/lib/scroll";
import { gsapEase, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

/** The `scene:` variant in globals.css, minus reduced motion (useGsap handles that). */
const SCENE_QUERY = "(min-width: 48rem) and (min-height: 37.5rem)";

type Step = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Which way the message travels: buyer → seller, or back. */
  dir: "out" | "back";
  tag: string;
  tone: string;
  /** What goes over the wire, first line first. */
  wire: [string, string][];
};

const STEPS: Step[] = [
  {
    icon: SendIcon,
    title: "Agent requests",
    body: "The buyer calls a seller's endpoint for one unit of work. No API key, no account.",
    dir: "out",
    tag: "GET",
    tone: "border-border bg-background text-foreground",
    wire: [
      ["GET /sellers/shelf-scraper/scrape?page=1", "text-foreground"],
      ["accept: application/json", "text-muted-foreground"],
    ],
  },
  {
    icon: LockIcon,
    title: "402 quote",
    body: "The seller answers 402 with a price, network and payTo address.",
    dir: "back",
    tag: "402",
    tone: "border-info/30 bg-info/10 text-info",
    wire: [
      ["402 Payment Required", "text-info"],
      ["PAYMENT-REQUIRED  0.005 USDC", "text-foreground"],
      ["network base-sepolia · payTo 0xf8ec…dFa1", "text-muted-foreground"],
    ],
  },
  {
    icon: PenLineIcon,
    title: "Agent authorises",
    body: "The buyer checks the quote against its budget, then signs an EIP-3009 transferWithAuthorization. No gas, no approval.",
    dir: "out",
    tag: "SIG",
    tone: "border-primary/30 bg-primary/10 text-primary",
    wire: [
      ["GET /sellers/shelf-scraper/scrape?page=1", "text-foreground"],
      ["PAYMENT-SIGNATURE  transferWithAuthorization", "text-primary"],
      ["EIP-3009 · signed off-chain by the buyer", "text-muted-foreground"],
    ],
  },
  {
    icon: CheckCircle2Icon,
    title: "Work, then settle",
    body: "The seller verifies the signature, does the work, checks its output, and only then settles on Base Sepolia through the facilitator.",
    dir: "back",
    tag: "200",
    tone: "border-ok/30 bg-ok/10 text-ok",
    wire: [
      ["200 OK · 20 books", "text-ok"],
      ["PAYMENT-RESPONSE  settled · tx 0x4b2a…", "text-foreground"],
      ["charged only after valid output", "text-muted-foreground"],
    ],
  },
];

const DIM = 0.35;

/**
 * "How it works": on a roomy screen the section pins and scrolling plays the
 * four moves of one paid call across a buyer → seller stage (about two extra
 * screens of scroll, with a skip button). On phones, short screens and for
 * reduced motion it is a stack of cards. The step list is the same DOM in both
 * modes, so screen readers always get every step; the stage is decoration.
 */
export function X402Flow() {
  const root = useRef<HTMLElement>(null);

  useGsap(root, ({ gsap, reduced }) => {
    if (reduced) return;
    const section = root.current!;
    const mm = gsap.matchMedia(section);

    mm.add(SCENE_QUERY, () => {
      const q = gsap.utils.selector(section);
      const steps = q("[data-step]");
      const panels = q("[data-panel]");
      const counts = q("[data-count]");
      const packets = q("[data-packet]");
      const glow = { buyer: q("[data-glow=buyer]"), seller: q("[data-glow=seller]") };
      const seller = q("[data-node=seller]");
      const header = document.querySelector<HTMLElement>("header");

      // The pinned frame starts under the sticky header, whatever its height.
      const setTop = () =>
        section.style.setProperty("--scene-top", `${header?.offsetHeight ?? 88}px`);
      setTop();

      gsap.set(steps.slice(1), { opacity: DIM });
      gsap.set([...panels.slice(1), ...counts.slice(1)], { opacity: 0, y: 10 });
      gsap.set(packets, {
        xPercent: (i: number) => (STEPS[i].dir === "out" ? 0 : 100),
        opacity: (i: number) => (i === 0 ? 1 : 0),
      });
      gsap.set(glow.buyer, { opacity: 1 });
      gsap.set(q("[data-rail]"), { scaleY: 0, transformOrigin: "50% 0%" });
      gsap.set(q("[data-progress]"), { scaleX: 0, transformOrigin: "0% 50%" });

      const tl = gsap.timeline({
        defaults: { ease: "none", duration: 0.15 },
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${innerHeight * 2}`,
          pin: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefreshInit: setTop,
        },
      });

      STEPS.forEach((step, i) => {
        const at = i;
        if (i > 0) {
          const sender = step.dir === "out" ? glow.buyer : glow.seller;
          const other = step.dir === "out" ? glow.seller : glow.buyer;
          tl.to(steps[i - 1], { opacity: DIM }, at)
            .to(steps[i], { opacity: 1 }, at)
            .to([panels[i - 1], counts[i - 1]], { opacity: 0, y: -10 }, at)
            .to([panels[i], counts[i]], { opacity: 1, y: 0 }, at)
            .to(packets[i - 1], { opacity: 0 }, at)
            .to(packets[i], { opacity: 1 }, at)
            .to(other, { opacity: 0 }, at)
            .to(sender, { opacity: 1 }, at);
        }
        const last = i === STEPS.length - 1;
        // Last move: the seller does the work before anything comes back.
        if (last) tl.to(seller, { keyframes: { scale: [1, 1.08, 1] }, duration: 0.3 }, at + 0.1);
        tl.to(
          packets[i],
          { xPercent: step.dir === "out" ? 100 : 0, duration: 0.5, ease: gsapEase.inOut },
          at + (last ? 0.4 : 0.15),
        );
      });

      // Paid only now: the "nothing charged" note gives way to the receipt.
      tl.to(q("[data-pending]"), { opacity: 0, y: -6 }, 3.9)
        .fromTo(q("[data-receipt]"), { opacity: 0, y: 6 }, { opacity: 1, y: 0 }, 3.9)
        .to({}, { duration: 0.3 });

      const span = tl.duration();
      tl.to(q("[data-rail]"), { scaleY: 1, duration: span }, 0).to(
        q("[data-progress]"),
        { scaleX: 1, duration: span },
        0,
      );

      // Content above (fonts, hero data) can change height after the pin is
      // measured; re-measure once things settle.
      let timer = 0;
      const ro = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = window.setTimeout(() => tl.scrollTrigger?.refresh(), 200);
      });
      ro.observe(document.body);

      return () => {
        clearTimeout(timer);
        ro.disconnect();
        section.style.removeProperty("--scene-top");
      };
    });

    return () => mm.revert();
  });

  /** Jump past the pinned walkthrough to the next section and move focus there. */
  function skip() {
    const section = root.current;
    if (!section) return;
    const outer = section.parentElement?.classList.contains("pin-spacer")
      ? section.parentElement
      : section;
    const next = outer.nextElementSibling as HTMLElement | null;
    if (!next) return;
    const headerH = Number.parseFloat(section.style.getPropertyValue("--scene-top")) || 0;
    const y = next.getBoundingClientRect().top + scrollY - headerH;
    const lenis = getLenis();
    if (lenis) {
      lenis.resize();
      lenis.scrollTo(y, { duration: 1.2 });
    } else {
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
    next.focus({ preventScroll: true });
  }

  return (
    <section
      ref={root}
      aria-labelledby="x402-flow-title"
      className="relative w-full py-16 scene:flex scene:min-h-svh scene:items-center scene:pt-[calc(var(--scene-top,5.5rem)+1.5rem)] scene:pb-8"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 scene:grid-cols-[0.9fr_1.1fr] scene:items-center scene:gap-12">
        <div className="flex flex-col">
          <Reveal>
            <div className="mb-10 flex flex-col gap-2 scene:mb-7">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                how it works
              </span>
              <h2 id="x402-flow-title" className="font-display text-3xl sm:text-4xl">
                One call, four moves
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                x402 turns an ordinary HTTP request into a paid one. Nothing is
                charged until the seller has delivered valid output.
              </p>
            </div>
          </Reveal>

          <div className="relative scene:pl-6">
            <span
              aria-hidden
              className="absolute inset-y-1 left-0 hidden w-px bg-border scene:block"
            >
              <span data-rail className="block size-full origin-top bg-primary" style={{ transform: "scaleY(0)" }} />
            </span>

            <ol className="grid gap-4 sm:grid-cols-2 scene:grid-cols-1 scene:gap-5">
              {STEPS.map((step, i) => (
                <motion.li
                  key={step.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ ...transition.slow, delay: i * 0.08 }}
                  className="rounded-2xl border border-border bg-card p-5 scene:rounded-none scene:border-0 scene:bg-transparent scene:p-0"
                >
                  <div data-step className="flex gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-background ring-1 ring-primary/10">
                      <step.icon className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          0{i + 1}
                        </span>
                        <h3 className="font-heading text-base font-medium">{step.title}</h3>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                      {/* Cards mode shows the wire message inline; the scene shows it on the stage. */}
                      <div className="mt-3 rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5 break-all scene:hidden">
                        <Wire step={step} />
                      </div>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>

          <button
            type="button"
            onClick={skip}
            className="mt-6 hidden items-center gap-1.5 self-start rounded-md px-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none scene:inline-flex"
          >
            Skip the walkthrough <ArrowDownIcon className="size-3.5" />
          </button>
        </div>

        <Stage />
      </div>
    </section>
  );
}

function Wire({ step }: { step: Step }) {
  return step.wire.map(([text, tone], j) => (
    <div key={j} className={cn(tone, j > 0 && "pl-4")}>
      {j === 0 && (step.dir === "out" ? "→ " : "← ")}
      {text}
    </div>
  ));
}

/** The buyer ⇄ seller stage. Pure decoration: the list beside it says it all. */
function Stage() {
  return (
    <div aria-hidden className="hidden scene:block">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm lg:p-8">
        <span className="absolute inset-x-0 top-0 h-0.5 bg-border/60">
          <span data-progress className="block size-full origin-left bg-primary" style={{ transform: "scaleX(0)" }} />
        </span>

        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>x402 v2 · base sepolia</span>
          <span className="relative h-4 w-16 text-right whitespace-nowrap">
            {STEPS.map((step, i) => (
              <span
                key={step.tag}
                data-count
                className={cn("absolute inset-0", i > 0 && "opacity-0")}
              >
                0{i + 1} / 04
              </span>
            ))}
          </span>
        </div>

        <div className="mt-8 flex items-start">
          <Node id="buyer" icon={BotIcon} label="Buyer agent" sub="budget-capped wallet" />
          <div className="relative mx-7 mt-8 h-px flex-1 bg-[repeating-linear-gradient(to_right,var(--border)_0_6px,transparent_6px_11px)]">
            {STEPS.map((step, i) => (
              <span
                key={step.tag}
                data-packet
                className={cn("absolute inset-0", i > 0 && "opacity-0")}
              >
                <span
                  className={cn(
                    "absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap shadow-sm",
                    step.tone,
                  )}
                >
                  {step.tag}
                </span>
              </span>
            ))}
          </div>
          <Node id="seller" icon={StoreIcon} label="Seller agent" sub="shelf-scraper" />
        </div>

        <div className="relative mt-8 h-30 rounded-2xl border border-border bg-background/70 font-mono text-xs leading-6">
          {STEPS.map((step, i) => (
            <div
              key={step.tag}
              data-panel
              className={cn("absolute inset-x-4 top-3.5 [&>div]:truncate", i > 0 && "opacity-0")}
            >
              <Wire step={step} />
            </div>
          ))}
        </div>

        <div className="relative mt-5 h-5 text-sm">
          <p data-pending className="absolute inset-0 flex items-center gap-2 text-muted-foreground">
            <LockIcon className="size-4" /> Nothing is charged until the seller delivers.
          </p>
          <p data-receipt className="absolute inset-0 flex items-center gap-2 text-ok opacity-0">
            <CheckCircle2Icon className="size-4" />
            <span className="font-mono">0.005 USDC</span> buyer → seller · settled on Base Sepolia
          </p>
        </div>
      </div>
    </div>
  );
}

function Node({
  id,
  icon: Icon,
  label,
  sub,
}: {
  id: "buyer" | "seller";
  icon: ComponentType<{ className?: string }>;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex w-28 shrink-0 flex-col items-center gap-2 text-center">
      <div
        data-node={id}
        className="relative flex size-16 items-center justify-center rounded-2xl border border-border bg-background"
      >
        <span data-glow={id} className="absolute -inset-1 rounded-[1.15rem] opacity-0 ring-2 ring-primary/45" />
        <Icon className="size-7 text-primary" />
      </div>
      <div className="text-sm font-medium">{label}</div>
      <div className="font-mono text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
