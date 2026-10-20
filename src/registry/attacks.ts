import { db } from "../db.js";

export type AttackKind = "overcharge" | "wrong_payto" | "bad_terms" | "unsafe_endpoint" | "junk_output" | "prompt_injection" | "replay";

const LABELS: Record<AttackKind, string> = {
  overcharge: "Overcharge",
  wrong_payto: "Swapped payTo",
  bad_terms: "Bad payment terms",
  unsafe_endpoint: "Unsafe endpoint",
  junk_output: "Junk output",
  prompt_injection: "Prompt injection",
  replay: "Replayed payment",
};

/** Which attack a buyer ledger row stopped, read from the reason SafePayer wrote; undefined for honest failures (budget, cap, outages). */
export function classifyAttack(status: string, reason: string | null): AttackKind | undefined {
  const r = reason ?? "";
  if (status === "refused") {
    if (r.startsWith("endpoint guard:")) return "unsafe_endpoint";
    if (!r.startsWith("price check:")) return undefined;
    if (/payTo .* differs/.test(r)) return "wrong_payto";
    if (/asked \d+ units/.test(r)) return "overcharge";
    return "bad_terms";
  }
  if (status === "paid_output_rejected") {
    if (r.startsWith("prompt injection:")) return "prompt_injection";
    if (r.startsWith("output breaks listed schema")) return "junk_output";
  }
  return undefined;
}

export interface AttackSummary {
  attacks: { kind: AttackKind; label: string; count: number; lastAt: string | null }[];
  total: number;
  /** What refused 402s asked for and never got, in USDC units. */
  notPaidUnits: string;
}

/** Counts every attack the buyer stopped: ledger rows (buyer side) plus replayed signatures the sellers rejected (sales). */
export function summariseAttacks(sales: { ts: string; status: string }[]): AttackSummary {
  const rows = db.prepare("SELECT ts, status, reason, asked FROM ledger WHERE status IN ('refused', 'paid_output_rejected')").all() as {
    ts: string;
    status: string;
    reason: string | null;
    asked: string | null;
  }[];
  const by = new Map<AttackKind, { count: number; lastAt: string | null }>(Object.keys(LABELS).map((k) => [k as AttackKind, { count: 0, lastAt: null }]));
  const hit = (kind: AttackKind, ts: string) => {
    const a = by.get(kind)!;
    a.count++;
    if (!a.lastAt || ts > a.lastAt) a.lastAt = ts;
  };
  let notPaid = 0n;
  for (const r of rows) {
    const kind = classifyAttack(r.status, r.reason);
    if (!kind) continue;
    hit(kind, r.ts);
    if (r.status === "refused" && r.asked && /^\d+$/.test(r.asked)) notPaid += BigInt(r.asked);
  }
  for (const s of sales) if (s.status === "replay_rejected") hit("replay", s.ts);
  const attacks = [...by].map(([kind, a]) => ({ kind, label: LABELS[kind], ...a }));
  return { attacks, total: attacks.reduce((n, a) => n + a.count, 0), notPaidUnits: notPaid.toString() };
}
