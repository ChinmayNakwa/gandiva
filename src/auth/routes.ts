import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { config } from "../config.js";
import { consumeNonce, createNonce, createSession, deleteSession, loginMessage, NONCE_TTL_MS, parseLoginMessage, SESSION_TTL_MS, sessionAddress } from "./session.js";

export const auth = new Hono();

export const SESSION_COOKIE = "gandiva_session";

/** The wallet address (lower case) signed in on this request, or null for a logged-out visitor. */
export const currentUser = (c: Context): string | null => sessionAddress(getCookie(c, SESSION_COOKIE));

/** Step 1 of signing in: the server makes the one-time code and the exact text the wallet must sign. */
auth.get("/challenge", (c) => {
  const { address, uri } = c.req.query();
  if (!address || !isAddress(address, { strict: false })) return c.json({ error: "address (0x...) is required" }, 400);
  let origin: string;
  try {
    const u = new URL(uri ?? "");
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    origin = u.origin;
  } catch {
    return c.json({ error: "uri must be the site address, e.g. https://example.com" }, 400);
  }
  try {
    const nonce = createNonce();
    return c.json({ nonce, message: loginMessage({ address: getAddress(address), nonce, issuedAt: new Date().toISOString(), uri: origin }) });
  } catch (err: any) {
    return c.json({ error: err.message }, 429);
  }
});

// Only for tests and scripts that build the message themselves.
auth.get("/nonce", (c) => {
  try {
    return c.json({ nonce: createNonce() });
  } catch (err: any) {
    return c.json({ error: err.message }, 429);
  }
});

auth.post("/login", bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "request too large" }, 413) }), async (c) => {
  const body = await c.req.json().catch(() => null);
  const { message, signature } = (body ?? {}) as { message?: unknown; signature?: unknown };
  if (typeof message !== "string" || typeof signature !== "string") return c.json({ error: "message and signature (strings) are required" }, 400);

  const fields = parseLoginMessage(message);
  if (!fields || message !== loginMessage(fields)) return c.json({ error: "this is not a Gandiva sign-in message" }, 400);
  // Browsers always send Origin on a POST. A page on another site cannot get a signature for our site through this check.
  const origin = c.req.header("origin");
  if (origin && origin !== fields.uri) return c.json({ error: "sign-in message was made for a different site" }, 400);
  const issued = Date.parse(fields.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > NONCE_TTL_MS) return c.json({ error: "sign-in message is too old, try again" }, 400);

  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    return c.json({ error: "signature is not valid" }, 400);
  }
  if (signer.toLowerCase() !== fields.address.toLowerCase()) return c.json({ error: "signature does not match the address in the message" }, 401);
  if (!consumeNonce(fields.nonce)) return c.json({ error: "sign-in code expired or already used, try again" }, 401);

  const session = createSession(signer);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.publicBaseUrl.startsWith("https://"),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return c.json({ address: signer.toLowerCase() });
});

auth.get("/me", (c) => c.json({ address: currentUser(c) }));

auth.post("/logout", (c) => {
  deleteSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
