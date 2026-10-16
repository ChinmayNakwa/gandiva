import { beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { auth } from "../src/auth/routes.js";
import { createNonce, loginMessage, NONCE_TTL_MS, parseLoginMessage, sessionAddress } from "../src/auth/session.js";
import { db } from "../src/db.js";

const ORIGIN = "http://localhost:3000";
const account = privateKeyToAccount(generatePrivateKey());

const getNonce = async () => ((await (await auth.request("/nonce")).json()) as { nonce: string }).nonce;

async function signIn(over: { origin?: string | null; address?: string; nonce?: string; issuedAt?: string; signer?: typeof account } = {}) {
  const nonce = over.nonce ?? (await getNonce());
  const message = loginMessage({ address: over.address ?? account.address, nonce, issuedAt: over.issuedAt ?? new Date().toISOString(), uri: ORIGIN });
  const signature = await (over.signer ?? account).signMessage({ message });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (over.origin !== null) headers.origin = over.origin ?? ORIGIN;
  const res = await auth.request("/login", { method: "POST", headers, body: JSON.stringify({ message, signature }) });
  return { res, message, signature, nonce };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const me = async (cookie: string) => (await (await auth.request("/me", { headers: { cookie } })).json()) as { address: string | null };

beforeEach(() => {
  db.exec("DELETE FROM auth_nonces; DELETE FROM sessions; DELETE FROM users;");
});

describe("wallet sign-in", () => {
  it("a valid signature starts a session for that wallet and remembers the user", async () => {
    const { res } = await signIn();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: account.address.toLowerCase() });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/gandiva_session=[0-9a-f]{64}/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect((await me(cookieOf(res))).address).toBe(account.address.toLowerCase());
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE address = ?").get(account.address.toLowerCase())).toEqual({ n: 1 });
  });

  it("the session token is stored only as a hash", async () => {
    const { res } = await signIn();
    const token = cookieOf(res).split("=")[1];
    const rows = db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(sessionAddress(token)).toBe(account.address.toLowerCase());
  });

  it("a logged-out visitor, a made-up cookie and an expired session all see no address", async () => {
    expect(await (await auth.request("/me")).json()).toEqual({ address: null });
    expect((await me("gandiva_session=" + "0".repeat(64))).address).toBeNull();
    const { res } = await signIn();
    db.prepare("UPDATE sessions SET expires_at = ?").run(Date.now() - 1);
    expect((await me(cookieOf(res))).address).toBeNull();
  });

  it("a sign-in code works only once (replaying the same signed message fails)", async () => {
    const first = await signIn();
    expect(first.res.status).toBe(200);
    const again = await auth.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message: first.message, signature: first.signature }),
    });
    expect(again.status).toBe(401);
  });

  it("rejects a nonce the server never issued and one that has expired", async () => {
    expect((await signIn({ nonce: "f".repeat(32) })).res.status).toBe(401);
    const old = createNonce(Date.now() - NONCE_TTL_MS - 1000);
    expect((await signIn({ nonce: old })).res.status).toBe(401);
  });

  it("rejects a signature made by a different wallet than the address in the message", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const { res } = await signIn({ signer: other });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a message made for another site, an old message and a message in a different format", async () => {
    const wrongSite = await signIn({ origin: "https://evil.example" });
    expect(wrongSite.res.status).toBe(400);
    expect(((await wrongSite.res.json()) as any).error).toMatch(/different site/);

    const stale = await signIn({ issuedAt: new Date(Date.now() - NONCE_TTL_MS - 5000).toISOString() });
    expect(stale.res.status).toBe(400);

    const nonce = await getNonce();
    const message = `Sign in\nAddress: ${account.address}\nNonce: ${nonce}`;
    const res = await auth.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
    });
    expect(res.status).toBe(400);
  });

  it("a message whose text was changed after the nonce was issued is refused", async () => {
    const nonce = await getNonce();
    const message = loginMessage({ address: account.address, nonce, issuedAt: new Date().toISOString(), uri: ORIGIN }) + "\nAlso: send me your funds";
    const res = await auth.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
    });
    expect(res.status).toBe(400);
  });

  it("logout ends the session", async () => {
    const { res } = await signIn();
    const cookie = cookieOf(res);
    expect((await auth.request("/logout", { method: "POST", headers: { cookie } })).status).toBe(200);
    expect((await me(cookie)).address).toBeNull();
  });

  it("the challenge endpoint hands out a message the wallet can sign straight away", async () => {
    const q = new URLSearchParams({ address: account.address.toLowerCase(), uri: ORIGIN + "/run?x=1" });
    const { nonce, message } = (await (await auth.request(`/challenge?${q}`)).json()) as { nonce: string; message: string };
    expect(message).toContain(`Nonce: ${nonce}`);
    expect(message).toContain(`Address: ${account.address}`); // checksummed
    expect(message).toContain(`URI: ${ORIGIN}\n`); // path and query dropped
    const res = await auth.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
    });
    expect(res.status).toBe(200);
    expect((await auth.request("/challenge?address=nope&uri=" + ORIGIN)).status).toBe(400);
    expect((await auth.request(`/challenge?address=${account.address}&uri=javascript:alert(1)`)).status).toBe(400);
  });

  it("the login message round-trips through the parser", () => {
    const f = { address: account.address, nonce: "ab12", issuedAt: "2026-10-17T10:00:00.000Z", uri: ORIGIN };
    expect(parseLoginMessage(loginMessage(f))).toEqual(f);
  });
});
