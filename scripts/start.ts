// One command: opens a public HTTPS tunnel, then starts the server with that URL so every registry listing
// and 402 resource URL is publicly reachable.
// TUNNEL=auto (default: cloudflared, then ngrok) | cloudflared | ngrok | none. A preset PUBLIC_BASE_URL skips tunnelling.
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const port = process.env.PORT || "4021";
const exe = process.platform === "win32" ? ".exe" : "";
const local = (name: string) => process.env[`${name.toUpperCase()}_PATH`] || resolve("tools", name + exe);
const bin = (name: string) => (existsSync(local(name)) ? local(name) : name);
// Local binaries run directly; bare names go through the shell so PATH lookup works everywhere.
const useShell = (name: string) => !existsSync(local(name));
const has = (name: string) => spawnSync(bin(name), ["--version"], { stdio: "ignore", shell: useShell(name) }).status === 0;
const children: ChildProcess[] = [];

function startServer(publicBaseUrl?: string) {
  const env = { ...process.env, ...(publicBaseUrl ? { PUBLIC_BASE_URL: publicBaseUrl } : {}) };
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { stdio: "inherit", env });
  children.push(child);
  child.on("exit", (code) => shutdown(code ?? 0));
}

function shutdown(code = 0) {
  for (const c of children) c.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

/** Starts a tunnel and resolves with its public URL once it is actually connected, or null on failure/timeout. */
function openTunnel(kind: "cloudflared" | "ngrok"): Promise<string | null> {
  return new Promise((resolve) => {
    const args =
      kind === "cloudflared"
        ? ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`]
        : ["http", port, "--log", "stdout", "--log-format", "logfmt", ...(process.env.NGROK_DOMAIN ? ["--url", process.env.NGROK_DOMAIN] : [])];
    const child = spawn(bin(kind), args, { shell: useShell(kind) });
    children.push(child);
    let url: string | null = null;
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!v) child.kill();
      resolve(v);
    };
    const timer = setTimeout(() => {
      console.warn(`${kind}: no connection after 45s${kind === "cloudflared" ? " (outbound port 7844 may be blocked on this network)" : ""}`);
      finish(null);
    }, 45_000);
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      if (kind === "cloudflared") {
        url ??= text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
        if (url && /Registered tunnel connection/.test(text)) finish(url);
      } else {
        const m = text.match(/url=(https:\/\/[^\s]+)/);
        if (m) finish(m[1]);
        if (/ERR_NGROK|authentication failed/i.test(text)) {
          console.warn(`ngrok: ${text.trim().slice(0, 200)}`);
          finish(null);
        }
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", () => finish(null));
  });
}

const mode = (process.env.TUNNEL || "auto").toLowerCase();
if (process.env.PUBLIC_BASE_URL) {
  console.log(`Using PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL}`);
  startServer();
} else if (mode === "none") {
  startServer();
} else {
  const order = (mode === "auto" ? ["cloudflared", "ngrok"] : [mode]) as ("cloudflared" | "ngrok")[];
  let url: string | null = null;
  for (const kind of order) {
    if (!has(kind)) {
      console.warn(`${kind} not found (install it or put the binary in tools/)`);
      continue;
    }
    console.log(`Opening ${kind} tunnel...`);
    url = await openTunnel(kind);
    if (url) break;
  }
  if (url) console.log(`Public URL: ${url}`);
  else console.warn("No public tunnel; starting locally only. Set PUBLIC_BASE_URL or TUNNEL to fix.");
  startServer(url ?? undefined);
}
