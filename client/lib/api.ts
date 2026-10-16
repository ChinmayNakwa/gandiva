import type {
  Info,
  LedgerResponse,
  Run,
  SalesResponse,
  ServicesResponse,
} from "./types";

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(data?.error || `request failed (${res.status})`);
  }
  return data as T;
}

export const fetcher = <T>(url: string): Promise<T> => get<T>(url);

export const getInfo = () => get<Info>("/api/info");

export interface ServiceQuery {
  category?: string;
  maxPrice?: string;
  sort?: string;
}

export function servicesUrl(q: ServiceQuery = {}): string {
  const params = new URLSearchParams();
  if (q.category) params.set("category", q.category);
  if (q.maxPrice) params.set("maxPrice", q.maxPrice);
  if (q.sort) params.set("sort", q.sort);
  const qs = params.toString();
  return `/registry/services${qs ? `?${qs}` : ""}`;
}

export const getServices = (q: ServiceQuery = {}) =>
  get<ServicesResponse>(servicesUrl(q));

export const getLedger = (runId?: string) =>
  get<LedgerResponse>(`/registry/ledger${runId ? `?runId=${runId}` : ""}`);

export const getSales = () => get<SalesResponse>("/registry/sales");

export const getRun = (id: string) => get<Run>(`/buyer/runs/${id}`);

export const getRuns = () =>
  get<{ runs: (Pick<Run, "id" | "task" | "state" | "startedAt" | "spent" | "budget">)[] }>(
    "/buyer/runs",
  );

export function startRun(body: {
  task: string;
  budget: string;
  maxConcurrency: number;
  token?: string;
}) {
  return get<{ runId: string }>("/buyer/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(body.token ? { "x-buyer-token": body.token } : {}),
    },
    body: JSON.stringify({
      task: body.task,
      budget: body.budget,
      maxConcurrency: body.maxConcurrency,
    }),
  });
}
