import { MAX_PRICE_UNITS } from "../config.js";

/**
 * Priority scheduler for paid calls that contend at the same moment.
 *
 * Each paying wallet gets a pool of slots (several runs can share one wallet), and each seller accepts only a few calls
 * at once across all wallets. When more calls want to start than there are free slots, the waiting call with the highest
 * priority goes first. Priority is a weighted sum of five factors in [0, 1]:
 *
 *   retry        a settlement retry: money is already in motion, finish it first
 *   waited       time spent queued (ageing, so nothing starves)
 *   progress     how much of its run's budget is already spent: nearly finished runs complete and free up first
 *   reliability  the seller's reputation: calls likely to succeed don't waste a slot
 *   smallness    a cheaper call locks less money while in flight
 *
 * Equal priorities keep arrival order. A call that has waited longer than `maxWaitMs` starts anyway, so a seller that
 * hires other sellers can never deadlock against its own buyers.
 */
export const PRIORITY_WEIGHTS = { retry: 0.3, waited: 0.25, progress: 0.2, reliability: 0.15, smallness: 0.1 } as const;
export type PriorityFactor = keyof typeof PRIORITY_WEIGHTS;

export interface CallRequest {
  wallet: string;
  sellerId: string;
  sellerName: string;
  runId?: string;
  step?: string;
  price: bigint;
  /** Run budget and what is already spent or reserved of it. */
  budget: bigint;
  spent: bigint;
  /** Seller reputation score in (0, 1]. */
  reputation: number;
  retry?: boolean;
}

export interface QueueInfo {
  priority: number;
  factors: Record<PriorityFactor, number>;
  position: number;
  waitedMs: number;
}

export interface Slot {
  release(): void;
  waitedMs: number;
  priority: number;
  factors: Record<PriorityFactor, number>;
  /** Calls it was chosen ahead of, when there was contention. */
  beat: string[];
  forced: boolean;
}

interface Waiter {
  seq: number;
  req: CallRequest;
  enqueuedAt: number;
  resolve: (s: Slot) => void;
  onQueue?: (q: QueueInfo) => void;
}

export interface ContentionEvent {
  ts: string;
  wallet: string;
  winner: { label: string; priority: number; factors: Record<PriorityFactor, number> };
  waiting: { label: string; priority: number; factors: Record<PriorityFactor, number> }[];
  reason: string;
}

const label = (r: CallRequest) => [r.sellerName, r.step, r.runId && `run ${r.runId}`].filter(Boolean).join(" · ");

export class PaymentScheduler {
  private seq = 0;
  private waiting: Waiter[] = [];
  private walletBusy = new Map<string, number>();
  private sellerBusy = new Map<string, number>();
  private events: ContentionEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly perWallet = 5,
    readonly perSeller = 4,
    readonly maxWaitMs = 30_000,
    private now = () => Date.now(),
  ) {}

  factors(req: CallRequest, waitedMs: number): Record<PriorityFactor, number> {
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    return {
      retry: req.retry ? 1 : 0,
      waited: clamp(waitedMs / 10_000),
      progress: req.budget > 0n ? clamp(Number(req.spent) / Number(req.budget)) : 0,
      reliability: clamp(req.reputation),
      smallness: clamp(1 - Number(req.price) / Number(MAX_PRICE_UNITS)),
    };
  }

  priority(f: Record<PriorityFactor, number>) {
    return Number((Object.keys(PRIORITY_WEIGHTS) as PriorityFactor[]).reduce((a, k) => a + PRIORITY_WEIGHTS[k] * f[k], 0).toFixed(4));
  }

  /** Waits for a slot. `onQueue` reports priority and position while the call is queued. */
  acquire(req: CallRequest, onQueue?: (q: QueueInfo) => void): Promise<Slot> {
    return new Promise((resolve) => {
      this.waiting.push({ seq: ++this.seq, req, enqueuedAt: this.now(), resolve, onQueue });
      this.dispatch();
    });
  }

  private free(r: CallRequest) {
    return (this.walletBusy.get(r.wallet) ?? 0) < this.perWallet && (this.sellerBusy.get(r.sellerId) ?? 0) < this.perSeller;
  }

  private ranked() {
    const now = this.now();
    return this.waiting
      .map((w) => {
        const f = this.factors(w.req, now - w.enqueuedAt);
        return { w, f, p: this.priority(f), waited: now - w.enqueuedAt };
      })
      .sort((a, b) => b.p - a.p || a.w.seq - b.w.seq);
  }

  private dispatch() {
    for (;;) {
      const ranked = this.ranked();
      const pick = ranked.find((x) => this.free(x.w.req)) ?? ranked.find((x) => x.waited >= this.maxWaitMs);
      if (!pick) break;
      const forced = !this.free(pick.w.req);
      const rivals = ranked.filter((x) => x !== pick);
      this.waiting = this.waiting.filter((w) => w !== pick.w);
      const { wallet, sellerId } = pick.w.req;
      this.walletBusy.set(wallet, (this.walletBusy.get(wallet) ?? 0) + 1);
      this.sellerBusy.set(sellerId, (this.sellerBusy.get(sellerId) ?? 0) + 1);
      if (rivals.length) this.note(pick, rivals, forced);
      let released = false;
      pick.w.resolve({
        waitedMs: pick.waited,
        priority: pick.p,
        factors: pick.f,
        beat: rivals.map((r) => label(r.w.req)),
        forced,
        release: () => {
          if (released) return;
          released = true;
          this.walletBusy.set(wallet, (this.walletBusy.get(wallet) ?? 1) - 1);
          this.sellerBusy.set(sellerId, (this.sellerBusy.get(sellerId) ?? 1) - 1);
          this.dispatch();
        },
      });
    }
    this.report();
    // Ageing changes priorities over time, and forced starts depend on waiting time: re-check while anything waits.
    if (this.waiting.length && !this.timer) {
      this.timer = setInterval(() => this.dispatch(), 1_000);
      this.timer.unref?.();
    } else if (!this.waiting.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private report() {
    const ranked = this.ranked();
    ranked.forEach((x, i) => x.w.onQueue?.({ priority: x.p, factors: x.f, position: i + 1, waitedMs: x.waited }));
  }

  private note(pick: ReturnType<PaymentScheduler["ranked"]>[number], rivals: ReturnType<PaymentScheduler["ranked"]>, forced: boolean) {
    const top = (Object.keys(PRIORITY_WEIGHTS) as PriorityFactor[])
      .map((k) => ({ k, d: PRIORITY_WEIGHTS[k] * (pick.f[k] - (rivals[0]?.f[k] ?? 0)) }))
      .sort((a, b) => b.d - a.d)[0];
    const reason = forced
      ? `started after waiting ${Math.round(pick.waited / 1000)} s (no call waits longer than ${this.maxWaitMs / 1000} s)`
      : rivals[0] && pick.p === rivals[0].p
        ? "equal priority: arrived first"
        : `highest priority ${pick.p.toFixed(2)}; biggest edge: ${top?.k ?? "n/a"}`;
    this.events.unshift({
      ts: new Date(this.now()).toISOString(),
      wallet: pick.w.req.wallet,
      winner: { label: label(pick.w.req), priority: pick.p, factors: pick.f },
      waiting: rivals.slice(0, 5).map((r) => ({ label: label(r.w.req), priority: r.p, factors: r.f })),
      reason,
    });
    this.events.length = Math.min(this.events.length, 50);
  }

  status() {
    return {
      weights: PRIORITY_WEIGHTS,
      perWallet: this.perWallet,
      perSeller: this.perSeller,
      maxWaitMs: this.maxWaitMs,
      busy: { wallets: Object.fromEntries(this.walletBusy), sellers: Object.fromEntries(this.sellerBusy) },
      queue: this.ranked().map((x, i) => ({ position: i + 1, label: label(x.w.req), wallet: x.w.req.wallet, priority: x.p, factors: x.f, waitedMs: x.waited })),
      contention: this.events,
    };
  }
}

export const scheduler = new PaymentScheduler(Number(process.env.PAY_SLOTS_PER_WALLET ?? 5), Number(process.env.PAY_SLOTS_PER_SELLER ?? 4));
