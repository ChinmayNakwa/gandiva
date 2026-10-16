import { Mutex } from "async-mutex";

export interface Reservation {
  amount: bigint;
  commit(): void;
  release(): void;
}

/**
 * Spend guard shared by every call in a run. A call must reserve its amount before signing;
 * spent + reserved can never exceed the budget, no matter how many calls run in parallel.
 */
export class BudgetLedger {
  spent = 0n;
  reserved = 0n;
  private mutex = new Mutex();

  constructor(readonly budget: bigint) {}

  get remaining() {
    return this.budget - this.spent - this.reserved;
  }

  reserve(amount: bigint): Promise<Reservation | null> {
    return this.mutex.runExclusive(() => {
      if (amount <= 0n || this.spent + this.reserved + amount > this.budget) return null;
      this.reserved += amount;
      let done = false;
      return {
        amount,
        commit: () => {
          if (done) return;
          done = true;
          this.reserved -= amount;
          this.spent += amount;
        },
        release: () => {
          if (done) return;
          done = true;
          this.reserved -= amount;
        },
      };
    });
  }
}
