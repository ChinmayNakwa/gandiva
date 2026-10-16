import { Mutex } from "async-mutex";
import { config, fromUnits } from "../config.js";
import { spentSince } from "../registry/store.js";

export interface CapReservation {
  release(): void;
}

/**
 * Wallet-level spend cap shared by every run and every direct call, independent of per-run budgets.
 * Counts what the ledger says was spent (or may have been, for unconfirmed rows) in the rolling window plus
 * payments in flight, so a flood of runs cannot drain the buyer wallet.
 */
export class SpendCap {
  private inFlight = 0n;
  private mutex = new Mutex();

  constructor(
    readonly limit: bigint,
    readonly windowMs: number,
  ) {}

  get enabled() {
    return this.limit > 0n && this.windowMs > 0;
  }

  /** Spent in the window plus in flight. */
  used(now = Date.now()): bigint {
    return spentSince(new Date(now - this.windowMs).toISOString()) + this.inFlight;
  }

  status(now = Date.now()) {
    const used = this.used(now);
    return {
      enabled: this.enabled,
      limit: this.limit.toString(),
      limitUsdc: fromUnits(this.limit),
      windowMinutes: Math.round(this.windowMs / 60_000),
      used: used.toString(),
      usedUsdc: fromUnits(used),
      remaining: (this.limit > used ? this.limit - used : 0n).toString(),
      remainingUsdc: fromUnits(this.limit > used ? this.limit - used : 0n),
    };
  }

  /** Hold `amount` against the cap until release(). Release only after the ledger row for the payment has been written. */
  reserve(amount: bigint, now = Date.now()): Promise<CapReservation | null> {
    return this.mutex.runExclusive(() => {
      if (this.enabled && this.used(now) + amount > this.limit) return null;
      this.inFlight += amount;
      let done = false;
      return {
        release: () => {
          if (done) return;
          done = true;
          this.inFlight -= amount;
        },
      };
    });
  }
}

export const spendCap = new SpendCap(config.spendCap.limit, config.spendCap.windowMs);
