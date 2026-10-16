/** Services whose 402/payTo/output is deliberately hostile, for the demo. */
export const ADVERSARIAL_IDS = new Set(["cheap-scraper", "mirror-scraper", "junk-fx"]);

/** USDC smallest units (6 decimals) -> trimmed human string. */
export function usdc(units?: string | number | null): string {
  if (units === null || units === undefined) return "0";
  const n = Number(units) / 1e6;
  if (!Number.isFinite(n)) return "0";
  return n
    .toFixed(6)
    .replace(/\.?0+$/, "")
    .replace(/^$/, "0");
}

export function short(addr?: string | null): string {
  if (!addr) return "—";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function explorerTx(hash?: string | null): string | null {
  return hash ? `https://sepolia.basescan.org/tx/${hash}` : null;
}

export function explorerAddress(addr?: string | null): string | null {
  return addr ? `https://sepolia.basescan.org/address/${addr}` : null;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** "2026-10-16T19:35:00.000Z" -> "10-16 19:35:00" */
export function clock(ts?: string | null): string {
  if (!ts) return "";
  return ts.slice(5, 19).replace("T", " ");
}

export function stars(n: number): string {
  return "★".repeat(Math.max(0, Math.min(5, n)));
}

export function statusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "paid";
    case "paid_output_rejected":
      return "paid, output rejected";
    case "failed_not_charged":
      return "failed, not charged";
    case "refused":
      return "refused";
    case "replay_rejected":
      return "replay rejected";
    default:
      return status.replace(/_/g, " ");
  }
}
