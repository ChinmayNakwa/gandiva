import useSWR from "swr";
import { fetcher, servicesUrl, type ServiceQuery } from "./api";
import type {
  AgentWalletInfo,
  CompareResponse,
  Info,
  StakeOverview,
  LedgerResponse,
  Run,
  SalesResponse,
  ServicesResponse,
} from "./types";

export function useInfo() {
  return useSWR<Info>("/api/info", fetcher, { refreshInterval: 15000 });
}

export function useServices(q: ServiceQuery = {}) {
  return useSWR<ServicesResponse>(servicesUrl(q), fetcher, {
    keepPreviousData: true,
  });
}

export function useLedger(runId?: string) {
  return useSWR<LedgerResponse>(
    `/registry/ledger${runId ? `?runId=${runId}` : ""}`,
    fetcher,
    { refreshInterval: 4000 },
  );
}

export function useSales() {
  return useSWR<SalesResponse>("/registry/sales", fetcher, {
    refreshInterval: 4000,
  });
}

export function useRun(id?: string | null) {
  return useSWR<Run>(id ? `/buyer/runs/${id}` : null, fetcher, {
    refreshInterval: (run) => (run && run.state !== "running" ? 0 : 1200),
  });
}

/** Side-by-side comparison of the sellers competing in one category; null category = nothing selected. */
export function useCompare(category: string | null, selected?: string | null) {
  const q = category ? `/registry/compare?category=${category}${selected ? `&selected=${encodeURIComponent(selected)}` : ""}` : null;
  return useSWR<CompareResponse>(q, fetcher, { refreshInterval: 10000, keepPreviousData: true });
}

export function useStake() {
  return useSWR<StakeOverview>("/registry/stake", fetcher, { refreshInterval: 15000 });
}

/** The signed-in user's agent wallet (address, balance, spend cap). Pass false while signed out. */
export function useAgentWallet(enabled: boolean) {
  return useSWR<AgentWalletInfo>(enabled ? "/agent" : null, fetcher, { refreshInterval: 8000 });
}
