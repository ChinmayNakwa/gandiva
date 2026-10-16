import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { config } from "../config.js";
import { sampleFromSchema } from "../buyer/catalogue.js";
import { buildRequest, checkAgainstListing } from "../x402/safePayer.js";
import { validate } from "../x402/schema.js";
import { listServices, setVerification, SEED_OWNER, type Service, type Verification } from "./store.js";

export interface ProbeResult {
  verification: Verification;
  note: string;
}

/** True for loopback, private, link-local and other addresses that a public registry should never be pointed at. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(v4) === 6) return v4 === "::" || v4 === "::1" || /^f[cd]/.test(v4) || /^fe[89ab]/.test(v4) || v4.startsWith("ff");
  return false;
}

/** Why a listing's endpoint must not be accepted (null = fine). Blind to what the endpoint answers; only checks where it points. */
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
    return null; // not resolvable from here: the probe will report it as unreachable
  }
  return addresses.some(isPrivateAddress) ? "endpoint points at a private address; list a public URL" : null;
}

/**
 * Asks the listed endpoint for its 402 with sample input (no payment is ever signed) and compares the terms with the listing,
 * using the same rules the buyer applies before paying. Never throws.
 */
export async function probeListing(service: Service, opts: { timeoutMs?: number; endpoint?: string } = {}): Promise<ProbeResult> {
  const input = sampleFromSchema(service.inputSchema) as Record<string, unknown>;
  const sampleCheck = validate(service.inputSchema, input);
  const { url, init } = buildRequest({ endpoint: opts.endpoint ?? service.endpoint, method: service.method }, input);
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000) });
  } catch (err: any) {
    return { verification: "unchecked", note: `could not reach the endpoint: ${err?.cause?.code ?? err?.name ?? err?.message ?? err}` };
  }
  void res.body?.cancel().catch(() => {}); // only the status and headers matter; don't download or wait on the body

  if (res.status !== 402) {
    if (res.status >= 300 && res.status < 400) return { verification: "unchecked", note: `endpoint redirects (${res.status}); list the final URL` };
    if (res.ok) return { verification: "mismatch", note: "endpoint answered without asking for payment (expected a 402)" };
    const why = sampleCheck.ok ? "" : " (the sample input does not satisfy the listed inputSchema)";
    return { verification: "unchecked", note: `endpoint answered ${res.status} to the probe instead of a 402${why}` };
  }

  const header = res.headers.get("PAYMENT-REQUIRED");
  let pr: PaymentRequired;
  try {
    if (!header) throw new Error("no header");
    pr = decodePaymentRequiredHeader(header);
  } catch {
    return { verification: "mismatch", note: "402 without a decodable PAYMENT-REQUIRED header (not an x402 v2 challenge)" };
  }
  const check = checkAgainstListing(service, pr);
  if (!check.ok) return { verification: "mismatch", note: `402 contradicts the listing: ${check.reason}` };
  return { verification: "verified", note: "the endpoint's 402 matches the listed price, payTo, network and token" };
}

/** Probes a listing and stores the outcome. */
export async function verifyService(service: Service, opts?: Parameters<typeof probeListing>[1]): Promise<ProbeResult> {
  const result = await probeListing(service, opts);
  setVerification(service.id, { verification: result.verification, note: result.note });
  return result;
}

/** Probes the built-in sellers over loopback once the server is listening (their listed URLs may be a tunnel). */
export async function verifyBuiltIns(): Promise<void> {
  const local = `http://127.0.0.1:${config.port}`;
  await Promise.all(
    listServices()
      .filter((s) => s.owner === SEED_OWNER)
      .map((s) => verifyService(s, { endpoint: s.endpoint.replace(config.publicBaseUrl, local), timeoutMs: 20_000 })),
  );
}
