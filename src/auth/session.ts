import { createHash, randomBytes } from "node:crypto";
import { db } from "../db.js";
import { NETWORK } from "../config.js";

export const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;
const MAX_OPEN_NONCES = 10_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The exact text the wallet signs, in the Sign-In with Ethereum (EIP-4361) format so wallets can warn when the site asking
 * is not the one named. The server rebuilds it from the nonce, so nothing in it can be bent by the client.
 */
export function loginMessage(f: { address: string; nonce: string; issuedAt: string; uri: string }): string {
  return [
    `${URL.canParse(f.uri) ? new URL(f.uri).host : f.uri} wants you to sign in with your Ethereum account:`,
    f.address,
    "",
    "Signing only proves you own this wallet. It does not move any funds.",
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${NETWORK.split(":")[1]}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
  ].join("\n");
}

/** Pulls the fields back out of a login message; the caller then checks the message equals loginMessage(fields). */
export function parseLoginMessage(message: string): { address: string; nonce: string; issuedAt: string; uri: string } | null {
  const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(message)?.[1]?.trim();
  const address = message.split("\n")[1]?.trim();
  const nonce = field("Nonce");
  const issuedAt = field("Issued At");
  const uri = field("URI");
  return address && nonce && issuedAt && uri ? { address, nonce, issuedAt, uri } : null;
}

export function createNonce(now = Date.now()): string {
  db.prepare("DELETE FROM auth_nonces WHERE created_at < ?").run(now - NONCE_TTL_MS);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM auth_nonces").get() as { n: number };
  if (n >= MAX_OPEN_NONCES) throw new Error("too many pending sign-ins, try again in a few minutes");
  const nonce = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO auth_nonces (nonce, created_at) VALUES (?, ?)").run(nonce, now);
  return nonce;
}

/** A nonce works once: this deletes it and says whether it was still fresh. */
export function consumeNonce(nonce: string, now = Date.now()): boolean {
  const row = db.prepare("SELECT created_at FROM auth_nonces WHERE nonce = ?").get(nonce) as { created_at: number } | undefined;
  const removed = db.prepare("DELETE FROM auth_nonces WHERE nonce = ?").run(nonce).changes > 0;
  return Boolean(row) && removed && now - row!.created_at <= NONCE_TTL_MS;
}

export function createSession(address: string, now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO sessions (token_hash, address, created_at, expires_at) VALUES (?, ?, ?, ?)").run(sha256(token), address.toLowerCase(), now, expiresAt);
  db.prepare("INSERT OR IGNORE INTO users (address) VALUES (?)").run(address.toLowerCase());
  return { token, expiresAt };
}

/** The wallet address (lower case) behind a session token, or null if it is unknown or expired. */
export function sessionAddress(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const row = db.prepare("SELECT address, expires_at FROM sessions WHERE token_hash = ?").get(sha256(token)) as { address: string; expires_at: number } | undefined;
  return row && row.expires_at > now ? row.address : null;
}

export function deleteSession(token: string | undefined) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}
