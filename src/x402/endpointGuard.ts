import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config.js";

/** True for loopback, private, link-local and other addresses that a public registry should never be pointed at. */
export function isPrivateAddress(ip: string): boolean {
  // IPv4-mapped IPv6: URL parsing turns [::ffff:127.0.0.1] into ::ffff:7f00:1, which hides the IPv4. No public listing needs one.
  if (ip.toLowerCase().startsWith("::ffff:")) return true;
  const v4 = ip.toLowerCase();
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(v4) === 6) return v4 === "::" || v4 === "::1" || /^f[cd]/.test(v4) || /^fe[89ab]/.test(v4) || v4.startsWith("ff");
  return false;
}

/**
 * Why an endpoint must not be called (null = fine). Only checks where it points, not what it answers.
 * Used when a listing is made and again before every paid call, because DNS can change after listing.
 */
export async function endpointBlockedReason(endpoint: string, allowPrivate = config.allowPrivateEndpoints): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "endpoint is not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "endpoint must be an http(s) URL";
  if (url.username || url.password) return "endpoint must not contain credentials";
  if (allowPrivate) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "endpoint points at a private address; list a public URL";
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return null; // not resolvable from here: the call itself will fail as unreachable
  }
  return addresses.some(isPrivateAddress) ? "endpoint points at a private address; list a public URL" : null;
}
