import useSWR from "swr";
import { fetcher, servicesUrl, type ServiceQuery } from "./api";
import type {
  Info,
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
