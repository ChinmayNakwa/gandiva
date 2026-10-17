export type Category = "data" | "inference" | "scraping";

export type LedgerStatus =
  | "paid"
  | "paid_output_rejected"
  | "refused"
  | "failed_not_charged"
  | "unconfirmed";

export interface Reputation {
  attempts: number;
  successes: number;
  successRate: number;
  medianLatencyMs: number | null;
  score: number;
  isNew: boolean;
}

export interface Service {
  id: string;
  name: string;
  category: Category;
  endpoint: string;
  method: "GET" | "POST";
  price: string;
  network: string;
  asset: string;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  description: string;
  owner: string;
  /** What probing the endpoint's real 402 found: verified = matches the listing, mismatch = contradicts it, unchecked = could not tell. */
  verification: "verified" | "mismatch" | "unchecked";
  verificationNote: string;
  verifiedAt: string | null;
  reputation: Reputation;
}

export interface LedgerEntry {
  id: number;
  ts: string;
  run_id: string | null;
  buyer: string;
  seller: string;
  service_id: string | null;
  service_name: string;
  endpoint: string;
  listed: string;
  asked: string | null;
  paid: string;
  tx_hash: string | null;
  status: LedgerStatus;
  reason: string | null;
  latency_ms: number;
  explorer: string | null;
  listed_usdc: string;
  asked_usdc: string | null;
  paid_usdc: string;
}

export interface Sale {
  id: number;
  ts: string;
  seller: string;
  payer: string | null;
  amount: string;
  tx_hash: string | null;
  status: string;
  reason: string | null;
  latency_ms: number;
  explorer: string | null;
  amount_usdc: string;
}

export interface Purchase {
  step: string;
  service: string;
  serviceId: string;
  category: Category;
  seller: string;
  why: string;
  status: string;
  listed: string;
  asked?: string;
  paid: string;
  txHash?: string;
  explorer?: string;
  reason?: string;
  latencyMs: number;
}

/** requesting = first request sent; quoted = a 402 passed the checks; settling = signed, seller working and settling on chain. */
export type CallPhase = "requesting" | "quoted" | "settling";

/** A paid call happening right now. It leaves `Run.inflight` when its Purchase is recorded. */
export interface InflightCall {
  id: number;
  step: string;
  service: string;
  serviceId: string;
  phase: CallPhase;
  asked?: string;
  startedAt: string;
  phaseAt: string;
}

export interface RunResultBook {
  title: string;
  rating: number;
  price_gbp: number;
  url: string;
  summary_hi: string | null;
  [priceKey: string]: unknown;
}

export interface RunResult {
  currency: string;
  fxRate: number | null;
  fxDate: string | null;
  pagesScraped: number[];
  pagesMissing: number[];
  books: RunResultBook[];
}

/** Result of an agent run: a written answer plus named outputs the agent chose to hand back. */
export interface AgentResult {
  answer: string;
  outputs: Record<string, unknown>;
  turns?: number;
  dryRun?: boolean;
}

export interface QuoteLine {
  turn: number;
  as: string;
  service: string;
  category: Category;
  estimate: string;
  purpose?: string;
  skipped?: boolean;
}

export interface Quote {
  lines: QuoteLine[];
  total: string;
  byCategory: Partial<Record<Category, string>>;
  note: string;
}

export const isAgentResult = (r: RunResult | AgentResult): r is AgentResult =>
  typeof (r as AgentResult).answer === "string" && "outputs" in r;

export type RunStateName =
  | "running"
  | "completed"
  | "partial"
  | "needs_more_budget"
  | "failed";

export interface Run {
  id: string;
  task: string;
  budget: string;
  maxConcurrency: number;
  state: RunStateName;
  log: string[];
  planner?: string;
  /** agent = the LLM planned the run; legacy = built-in books pipeline (fallback). */
  mode?: "agent" | "legacy";
  dryRun?: boolean;
  quote?: Quote;
  purchases: Purchase[];
  inflight?: InflightCall[];
  result?: RunResult | AgentResult | null;
  explanation?: string;
  spent?: string;
  remaining?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface SellerInfo {
  id: string;
  payTo: string;
  endpoint: string;
  adversarial: boolean;
}

export interface Info {
  network: string;
  asset: string;
  facilitator: string;
  publicBaseUrl: string;
  buyer: string | null;
  sellers: SellerInfo[];
  llm: { host: string; model: string; available: boolean };
  buyerTokenRequired: boolean;
  /** Cap of the shared demo wallet (signed-in users get their own, see AgentWalletInfo). */
  spendCap: { enabled: boolean; limitUsdc: string; windowMinutes: number; usedUsdc: string; remainingUsdc: string };
}

export interface ServicesResponse {
  services: Service[];
}

export interface LedgerResponse {
  totalPaid: string;
  totalPaidUsdc: string;
  unconfirmedCount?: number;
  entries: LedgerEntry[];
}

export interface SalesResponse {
  sales: Sale[];
}

/** Settings of a Sell-tab LLM agent. The API key itself is never sent to the browser. */
export interface AgentInfo {
  host: string;
  model: string;
  systemPrompt: string;
  hasKey: boolean;
}

export interface AgentWalletInfo {
  user: string;
  address: string;
  network: string;
  asset: string;
  /** USDC smallest units; null when the chain could not be read. */
  balance: string | null;
  balanceUsdc: string | null;
  balanceError: string | null;
  spendCap: { enabled: boolean; limitUsdc: string; windowMinutes: number; usedUsdc: string; remainingUsdc: string };
  explorer: string;
  /** The user's own Ollama settings for planning (never the key). null = their runs plan on the server's key. */
  plannerLlm: { host: string; model: string; hasKey: boolean } | null;
  withdrawals: { id: number; ts: string; amount_usdc: string; status: "settled" | "failed" | "unknown"; tx_hash: string | null; explorer: string | null; reason: string | null }[];
}
