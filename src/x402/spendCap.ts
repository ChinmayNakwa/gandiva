import { Mutex } from "async-mutex";
import { privateKeyToAccount } from "viem/accounts";
import { config, fromUnits } from "../config.js";
import { spentSince } from "../registry/store.js";

export interface CapReservation {
  release(): void;
}

/**
 * Spend cap shared by every run and every direct call of one wallet, independent of per-run budgets.
 * Counts what the ledger says was spent (or may have been, for unconfirmed rows) in the rolling window plus
 * payments in flight, so a flood of runs cannot drain the wallet.
 * With `buyer` it counts only that wallet's ledger rows (each signed-in user's agent wallet has its own cap);
 * without it every row counts.
 */
export class SpendCap {
  private inFlight = 0n;
  private mutex = new Mutex();

  constructor(
    readonly limit: bigint,
    readonly windowMs: number,
    private readonly buyer?: string | (() => string | undefined),
  ) {}

  get enabled() {
    return this.limit > 0n && this.windowMs > 0;
  }

  /** Spent in the window plus in flight. */
  used(now = Date.now()): bigint {
    const buyer = typeof this.buyer === "function" ? this.buyer() : this.buyer;
    return spentSince(new Date(now - this.windowMs).toISOString(), buyer) + this.inFlight;
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

/** The shared demo wallet (BUYER_PRIVATE_KEY) counts only its own payments, so signed-in users' spending never eats into it. */
let sharedBuyer: string | undefined;
const sharedBuyerAddress = () => (sharedBuyer ??= config.buyerPrivateKey ? privateKeyToAccount(config.buyerPrivateKey).address.toLowerCase() : undefined);

export const spendCap = new SpendCap(config.spendCap.limit, config.spendCap.windowMs, sharedBuyerAddress);

/** A signed-in user's agent wallet gets its own cap with the same limit and window. */
export const capForWallet = (address: string) => new SpendCap(config.spendCap.limit, config.spendCap.windowMs, address.toLowerCase());
