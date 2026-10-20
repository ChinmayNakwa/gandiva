import type { Context } from "hono";
import { createHash } from "node:crypto";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Hex } from "viem";
import { config, NETWORK, USDC_ADDRESS, USDC_EIP712 } from "../config.js";
import { db } from "../db.js";
import { addSale } from "../registry/store.js";
import { outputHash, RECEIPT_HEADER, requestHash, schemaHash, signReceipt } from "../stake/receipt.js";
import { getResourceServer } from "./resourceServer.js";
import { validate, validateInput } from "./schema.js";

export class ServiceError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface PaidRouteOptions<I, O> {
  seller: string;
  description: string;
  /** Amount this seller's 402 asks for, in USDC units. Normally equals the registry listing. */
  price: bigint;
  payTo: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  timeoutMs?: number;
  /** Honest sellers check their own output before settling. Demo "junk" sellers turn this off. */
  selfValidate?: boolean;
  /** `info.payer` is who signed the payment (not yet settled): for sellers that spend money before they get paid. */
  handler: (input: I, info: { payer?: string }) => Promise<O>;
}

const claimNonce = db.prepare("INSERT INTO nonces (key, seller, status) VALUES (?, ?, 'pending') ON CONFLICT(key) DO NOTHING");
const releaseNonce = db.prepare("DELETE FROM nonces WHERE key = ? AND status = 'pending'");
const markSettled = db.prepare("UPDATE nonces SET status = 'settled', tx_hash = ? WHERE key = ?");

/** Replay guard shared with the paid MCP tools: claim before running, release on failure, mark when settled. */
export const replayGuard = {
  claim: (key: string, seller: string) => claimNonce.run(key, seller).changes > 0,
  release: (key: string) => void releaseNonce.run(key),
  settled: (key: string, tx: string) => void markSettled.run(tx, key),
};

/** The authorization nonce is what makes a payment unique; fall back to hashing the whole signed payload. */
export function nonceKey(payload: PaymentPayload): string {
  const auth = (payload.payload as any)?.authorization;
  if (auth?.nonce && auth?.from) return `${String(auth.from).toLowerCase()}:${auth.nonce}`;
  return "sig:" + createHash("sha256").update(JSON.stringify(payload.payload)).digest("hex");
}

const short = (s: string) => s.split("\n")[0].slice(0, 240);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ServiceError(`seller timed out after ${ms} ms`, 504)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Wraps a seller handler in x402 v2 "exact" payments with the order that guarantees
 * "no service, no charge" and "one authorisation, one response":
 *   402 challenge -> claim nonce (atomic) -> facilitator verify -> run handler -> validate output -> settle -> respond.
 */
export function paidRoute<I = any, O = any>(opts: PaidRouteOptions<I, O>) {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const selfValidate = opts.selfValidate ?? true;

  return async (c: Context) => {
    const started = Date.now();
    const url = new URL(c.req.url);
    const resourceUrl = config.publicBaseUrl + url.pathname + url.search;

    // The raw body is kept so the receipt can hash exactly what the buyer sent.
    const rawBody = c.req.method === "GET" ? "" : await c.req.text().catch(() => "");
    let input: any;
    if (c.req.method === "GET") input = { ...c.req.query() };
    else {
      try {
        input = JSON.parse(rawBody);
      } catch {
        input = {};
      }
    }
    const inputCheck = validateInput(opts.inputSchema, input);
    if (!inputCheck.ok) return c.json({ error: `invalid input: ${inputCheck.error}` }, 400);

    const server = await getResourceServer();
    const requirements = await server.buildPaymentRequirements({
      scheme: "exact",
      network: NETWORK,
      payTo: opts.payTo,
      price: { amount: opts.price.toString(), asset: USDC_ADDRESS, extra: { ...USDC_EIP712, assetTransferMethod: "eip3009" } },
      maxTimeoutSeconds: 120,
    });
    const resource = { url: resourceUrl, description: opts.description, mimeType: "application/json" };

    const challenge = async (error: string, status: 402 = 402) => {
      const pr = await server.createPaymentRequiredResponse(requirements, resource, error);
      c.header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(pr));
      c.header("Cache-Control", "no-store");
      return c.json(pr, status);
    };

    const sigHeader = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
    if (!sigHeader) return challenge("PAYMENT-SIGNATURE header is required");

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(sigHeader);
    } catch {
      return challenge("malformed PAYMENT-SIGNATURE header");
    }

    const matched: PaymentRequirements | undefined = server.findMatchingRequirements(requirements, payload);
    if (!matched) return challenge("payment does not match any accepted requirement");

    const key = nonceKey(payload);
    const payer = (payload.payload as any)?.authorization?.from as string | undefined;
    if (claimNonce.run(key, opts.seller).changes === 0) {
      addSale({ seller: opts.seller, payer, amount: "0", status: "replay_rejected", reason: "authorization already used", latencyMs: Date.now() - started });
      return c.json({ error: "payment authorization already used (replay rejected)" }, 409);
    }

    const fail = (status: number, error: string, saleStatus = "failed_not_charged") => {
      releaseNonce.run(key);
      addSale({ seller: opts.seller, payer, amount: "0", status: saleStatus, reason: error, latencyMs: Date.now() - started });
      return c.json({ error, charged: false }, status as any);
    };

    try {
      const verified = await server.verifyPayment(payload, matched);
      if (!verified.isValid) {
        releaseNonce.run(key);
        return challenge(short(`payment verification failed: ${verified.invalidReason ?? "invalid"} ${verified.invalidMessage ?? ""}`.trim()));
      }
    } catch (err: any) {
      releaseNonce.run(key);
      return challenge(short(`payment verification failed: ${err?.invalidReason ?? err?.message ?? String(err)}`));
    }

    let output: O;
    try {
      output = await withTimeout(opts.handler(input as I, { payer }), timeoutMs);
    } catch (err: any) {
      const status = err instanceof ServiceError ? err.status : 502;
      return fail(status, short(`service failed, not charged: ${err?.message ?? String(err)}`));
    }

    if (selfValidate) {
      const outCheck = validate(opts.outputSchema, output);
      if (!outCheck.ok) return fail(502, `service produced invalid output, not charged: ${outCheck.error}`);
    }

    // The facilitator occasionally fails a settlement submitted alongside others. Retrying the same authorisation
    // is safe: EIP-3009 nonces make a second transfer impossible if the first one did land.
    let settle: Awaited<ReturnType<typeof server.settlePayment>> | undefined;
    let settleError = "unknown";
    for (const delay of [0, 1500, 3500]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        settle = await server.settlePayment(payload, matched);
        if (settle.success) break;
        settleError = settle.errorReason ?? "unknown";
      } catch (err: any) {
        settleError = err?.errorReason ?? err?.message ?? String(err);
      }
      if (/insufficient|expired|valid_before|signature/i.test(settleError)) break;
    }
    if (!settle?.success) return fail(402, short(`settlement failed: ${settleError}`), "settle_failed");

    markSettled.run(settle.transaction, key);
    addSale({ seller: opts.seller, payer: settle.payer ?? payer, amount: matched.amount, txHash: settle.transaction, status: "paid", latencyMs: Date.now() - started });
    c.header("PAYMENT-RESPONSE", encodePaymentResponseHeader(settle));
    // Serialised once, so the receipt's outputHash covers the exact bytes sent.
    const bodyText = JSON.stringify(output);
    const paymentNonce = (payload.payload as any)?.authorization?.nonce;
    if (config.stake.receiptSignerKey && payer && /^0x[0-9a-fA-F]{64}$/.test(paymentNonce ?? "")) {
      try {
        const receipt = {
          payTo: opts.payTo as Hex,
          payer: payer as Hex,
          paymentNonce,
          requestHash: requestHash(c.req.method, url.pathname + url.search, rawBody),
          outputHash: outputHash(bodyText),
          schemaHash: schemaHash(opts.outputSchema),
          httpStatus: 200,
        };
        c.header(RECEIPT_HEADER, await signReceipt(config.stake.receiptSignerKey, receipt));
      } catch (err: any) {
        // The buyer has paid by now: a receipt problem must never cost them the response.
        console.warn(`[${opts.seller}] could not sign the receipt: ${err?.message ?? err}`);
      }
    }
    return c.body(bodyText, 200, { "Content-Type": "application/json" });
  };
}
