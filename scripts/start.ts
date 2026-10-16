// One command: opens a public HTTPS tunnel pointed at the Next.js front door, then starts
// BOTH the Hono API (internal) and Next.js (public) with that URL, so every registry listing
// and 402 resource URL is publicly reachable through the Next proxy.
// TUNNEL=auto (default: cloudflared, then ngrok) | cloudflared | ngrok | none. A preset PUBLIC_BASE_URL skips tunnelling.
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const apiPort = process.env.API_PORT || process.env.PORT || "4021";
const webPort = process.env.WEB_PORT || "3000";
const exe = process.platform === "win32" ? ".exe" : "";
const local = (name: string) => process.env[`${name.toUpperCase()}_PATH`] || resolve("tools", name + exe);
const bin = (name: string) => (existsSync(local(name)) ? local(name) : name);
// Local binaries run directly; bare names go through the shell so PATH lookup works everywhere.
const useShell = (name: string) => !existsSync(local(name));
const has = (name: string) => spawnSync(bin(name), ["--version"], { stdio: "ignore", shell: useShell(name) }).status === 0;
const children: ChildProcess[] = [];

function register(child: ChildProcess) {
  children.push(child);
  child.on("exit", (code) => shutdown(code ?? 0));
}

// Hono API: internal only, but it needs PUBLIC_BASE_URL so the seller/registry URLs it emits point at the front door.
function startApi(publicBaseUrl: string) {
  const env = { ...process.env, PORT: apiPort, PUBLIC_BASE_URL: publicBaseUrl };
  register(spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { stdio: "inherit", env }));
}

// Next.js front door: the public port and the tunnel target. It proxies /registry, /buyer, /sellers, /api to the API.
function startWeb(publicBaseUrl: string) {
  const env = { ...process.env, PORT: webPort, API_URL: `http://localhost:${apiPort}`, PUBLIC_BASE_URL: publicBaseUrl };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  register(spawn(npm, ["--prefix", "client", "run", "dev"], { stdio: "inherit", env, shell: useShell(npm) }));
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
        ? ["tunnel", "--no-autoupdate", "--url", `http://localhost:${webPort}`]
        : ["http", webPort, "--log", "stdout", "--log-format", "logfmt", ...(process.env.NGROK_DOMAIN ? ["--url", process.env.NGROK_DOMAIN] : [])];
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
const preset = process.env.PUBLIC_BASE_URL?.trim();

let publicUrl = preset || "";
if (!preset && mode !== "none") {
  const order = (mode === "auto" ? ["cloudflared", "ngrok"] : [mode]) as ("cloudflared" | "ngrok")[];
  for (const kind of order) {
    if (!has(kind)) {
      console.warn(`${kind} not found (install it or put the binary in tools/)`);
      continue;
    }
    console.log(`Opening ${kind} tunnel...`);
    const url = await openTunnel(kind);
    if (url) {
      publicUrl = url;
      break;
    }
  }
}

if (publicUrl) console.log(`Public URL: ${publicUrl}  (Next.js front door on :${webPort}, API on :${apiPort})`);
else {
  publicUrl = `http://localhost:${webPort}`;
  console.warn(`No public tunnel; using ${publicUrl}. Set PUBLIC_BASE_URL or TUNNEL to change.`);
}

startApi(publicUrl);
startWeb(publicUrl);
