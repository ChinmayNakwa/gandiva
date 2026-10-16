import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

const children = new Map<string, ChildProcess>();
/** id -> loopback port of every running seller process (empty when sellers run inside the main server). */
export const sellerPorts = new Map<string, number>();
let stopping = false;

const prefixed = (id: string, stream: NodeJS.ReadableStream | null) => {
  let buf = "";
  stream?.on("data", (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) console.log(`[${id}] ${l}`);
  });
};

async function healthy(port: number, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function launch(id: string, port: number, quickFailures = 0) {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["--import", "tsx", "src/sellers/process.ts"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, SELLER_ID: id, SELLER_PORT: String(port), DB_PATH: `data/sellers/${id}.db`, PUBLIC_BASE_URL: config.publicBaseUrl },
  });
  children.set(id, child);
  prefixed(id, child.stdout);
  prefixed(id, child.stderr);
  child.on("exit", (code) => {
    if (stopping) return;
    const quick = Date.now() - startedAt < 10_000 ? quickFailures + 1 : 0;
    if (quick >= 4) return console.error(`[sellers] ${id} keeps failing to start (exit ${code}); giving up. Its calls will return 502.`);
    console.error(`[sellers] ${id} stopped (exit ${code}); restarting in 2s`);
    setTimeout(() => !stopping && launch(id, port, quick), 2000);
  });
}

export function stopSellerProcesses() {
  stopping = true;
  for (const c of children.values()) c.kill();
}

/**
 * Starts one process per seller on consecutive loopback ports and waits until each answers /healthz.
 * Returns id -> port for the proxy. A seller that does not come up in time is still routed to (502 until it does).
 */
export async function startSellerProcesses(ids: string[]): Promise<Map<string, number>> {
  mkdirSync("data/sellers", { recursive: true });
  const ports = new Map(ids.map((id, i) => [id, config.sellerBasePort + i] as const));
  for (const [id, port] of ports) {
    sellerPorts.set(id, port);
    launch(id, port);
  }
  process.on("exit", stopSellerProcesses);
  const ready = await Promise.all([...ports].map(async ([id, port]) => [id, await healthy(port, 60_000)] as const));
  for (const [id, ok] of ready) if (!ok) console.warn(`[sellers] ${id} did not answer within 60s`);
  return ports;
}

/** Receipts from every seller process, newest first, merged with the main server's own rows. */
export async function collectSales(local: any[], ports: ReadonlyMap<string, number>, limit = 500): Promise<any[]> {
  const remote = await Promise.all(
    [...ports].map(async ([id, port]) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/_sales?limit=${limit}`, { signal: AbortSignal.timeout(3000) });
        return res.ok ? (((await res.json()) as { sales: any[] }).sales ?? []) : [];
      } catch (err: any) {
        console.warn(`[sellers] could not read sales from ${id}: ${err?.message ?? err}`);
        return [];
      }
    }),
  );
  const all = [...local, ...remote.flat()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, limit);
  // Each database numbers its own rows, so ids would repeat; renumber the merged list.
  return all.map((s, i) => ({ ...s, id: all.length - i }));
}
