import type { Context } from "hono";

// Headers that describe one hop only, or that fetch has already rewritten after decoding the body.
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "content-length", "content-encoding"]);

/**
 * Forwards a request to a seller process listening on loopback, unchanged: same method, path, query, body and headers
 * (so the PAYMENT-SIGNATURE goes in and PAYMENT-REQUIRED / PAYMENT-RESPONSE come back). `mountedAt` is the prefix the
 * seller app is mounted under on this server, e.g. /sellers; the seller process serves the same full path.
 */
export function forwardTo(target: string, mountedAt: string, timeoutMs = 120_000) {
  return async (c: Context) => {
    const url = new URL(c.req.url);
    const headers = new Headers();
    c.req.raw.headers.forEach((v, k) => {
      if (!HOP.has(k.toLowerCase())) headers.set(k, v);
    });
    const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
    try {
      const res = await fetch(`${target}${url.pathname}${url.search}`, {
        method: c.req.method,
        headers,
        body: hasBody ? await c.req.arrayBuffer() : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      const out = new Headers();
      res.headers.forEach((v, k) => {
        if (!HOP.has(k.toLowerCase())) out.set(k, v);
      });
      return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
    } catch (err: any) {
      const what = url.pathname.startsWith(mountedAt) ? url.pathname.slice(mountedAt.length).split("/")[1] : "seller";
      console.error(`[sellers] ${what} process unreachable: ${err?.message ?? err}`);
      return c.json({ error: `seller ${what} is not reachable right now`, charged: false }, 502);
    }
  };
}
