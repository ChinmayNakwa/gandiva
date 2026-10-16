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
  purchases: Purchase[];
  result?: RunResult | null;
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
