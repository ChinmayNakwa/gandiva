import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { fromUnits, NETWORK } from "../config.js";
import { addLedger, type LedgerStatus, type Service } from "../registry/store.js";
import type { BudgetLedger } from "./budget.js";
import { validate } from "./schema.js";

export interface CallResult {
  status: LedgerStatus;
  ok: boolean;
  data?: any;
  txHash?: string;
  asked?: bigint;
  paid: bigint;
  reason?: string;
  latencyMs: number;
  ledgerId: number;
}

type Check = { ok: true; accept: PaymentRequirements } | { ok: false; reason: string };

/** Price check: only sign a 402 whose terms match the registry listing exactly (or ask for less). */
export function checkAgainstListing(service: Service, pr: PaymentRequired): Check {
  if (pr.x402Version !== 2) return { ok: false, reason: `unsupported x402Version ${pr.x402Version}` };
  const accepts = pr.accepts ?? [];
  if (!accepts.length) return { ok: false, reason: "402 lists no payment options" };
  const listed = BigInt(service.price);
  const problems: string[] = [];
  for (const a of accepts) {
    const p: string[] = [];
    if (a.scheme !== "exact") p.push(`scheme ${a.scheme} is not "exact"`);
    if (a.network !== service.network) p.push(`network ${a.network} differs from listed ${service.network}`);
    if (a.asset.toLowerCase() !== service.asset.toLowerCase()) p.push(`token ${a.asset} differs from listed ${service.asset}`);
    if (a.payTo.toLowerCase() !== service.payTo.toLowerCase()) p.push(`payTo ${a.payTo} differs from listed ${service.payTo}`);
    let amount: bigint;
    try {
      amount = BigInt(a.amount);
    } catch {
      amount = -1n;
    }
    if (amount < 0n) p.push(`amount ${a.amount} is not a valid integer`);
    else if (amount > listed) {
      const ratio = Number(amount) / Number(listed);
      p.push(`asked ${amount} units, ${ratio >= 2 ? ratio.toFixed(ratio % 1 ? 1 : 0) + "x" : "more than"} the listed ${listed}`);
    }
    if (!(a.maxTimeoutSeconds > 0 && a.maxTimeoutSeconds <= 3600)) p.push(`unreasonable maxTimeoutSeconds ${a.maxTimeoutSeconds}`);
    if (!p.length) return { ok: true, accept: a };
    problems.push(p.join(", "));
  }
  return { ok: false, reason: problems[0] };
}

export function buildRequest(service: Pick<Service, "endpoint" | "method">, input: Record<string, unknown>) {
  if (service.method === "GET") {
    const url = new URL(service.endpoint);
    for (const [k, v] of Object.entries(input ?? {})) url.searchParams.set(k, String(v));
    return { url: url.toString(), init: { method: "GET", headers: {} as Record<string, string> } };
  }
  return {
    url: service.endpoint,
    init: { method: service.method, headers: { "Content-Type": "application/json" } as Record<string, string>, body: JSON.stringify(input ?? {}) },
  };
}

async function readBody(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Buyer-side x402 v2 payer: 402 -> price check -> budget reservation -> sign (standard SDK) -> retry -> schema check -> ledger. */
export class SafePayer {
  readonly account: PrivateKeyAccount;
  private client: x402Client;

  constructor(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
    this.client = new x402Client();
    registerExactEvmScheme(this.client, { signer: this.account, networks: [NETWORK] });
  }

  get address() {
    return this.account.address;
  }

  async call(service: Service, input: Record<string, unknown>, ctx: { budget: BudgetLedger; runId?: string; timeoutMs?: number }): Promise<CallResult> {
    const started = Date.now();
    const timeoutMs = ctx.timeoutMs ?? 90_000;
    const base = { runId: ctx.runId, buyer: this.address, seller: service.payTo, serviceId: service.id, serviceName: service.name, endpoint: service.endpoint, listed: service.price };
    const finish = (r: Omit<CallResult, "latencyMs" | "ledgerId" | "ok">): CallResult => {
      const latencyMs = Date.now() - started;
      const row = addLedger({ ...base, asked: r.asked?.toString() ?? null, paid: r.paid.toString(), txHash: r.txHash ?? null, status: r.status, reason: r.reason ?? null, latencyMs });
      return { ...r, ok: r.status === "paid", latencyMs, ledgerId: row.id };
    };

    const { url, init } = buildRequest(service, input);
    let first: Response;
    try {
      first = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err: any) {
      return finish({ status: "failed_not_charged", paid: 0n, reason: `unreachable: ${err?.message ?? err}` });
    }

    if (first.status !== 402) {
      const body = await readBody(first);
      if (first.ok) return finish({ status: "failed_not_charged", paid: 0n, data: body, reason: "seller did not ask for payment (expected 402)" });
      return finish({ status: "failed_not_charged", paid: 0n, reason: `seller returned ${first.status} before payment: ${JSON.stringify(body).slice(0, 200)}` });
    }

    const header = first.headers.get("PAYMENT-REQUIRED");
    let pr: PaymentRequired;
    try {
      pr = header ? decodePaymentRequiredHeader(header) : await first.json();
    } catch {
      return finish({ status: "refused", paid: 0n, reason: "402 without a decodable PAYMENT-REQUIRED header" });
    }

    const check = checkAgainstListing(service, pr);
    const askedGuess = pr.accepts?.[0]?.amount ? BigInt(pr.accepts[0].amount) : undefined;
    if (!check.ok) return finish({ status: "refused", paid: 0n, asked: askedGuess, reason: `price check: ${check.reason}` });
    const asked = BigInt(check.accept.amount);

    const reservation = await ctx.budget.reserve(asked);
    if (!reservation) {
      return finish({
        status: "refused",
        paid: 0n,
        asked,
        reason: `budget: needs ${fromUnits(asked)} USDC but only ${fromUnits(ctx.budget.remaining)} of ${fromUnits(ctx.budget.budget)} is left`,
      });
    }

    let paidRes: Response;
    try {
      const payload = await this.client.createPaymentPayload({ ...pr, accepts: [check.accept] });
      paidRes = await fetch(url, {
        ...init,
        headers: { ...init.headers, "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      // A timeout after sending the signature is ambiguous; keep the money reserved so the budget stays safe.
      reservation.commit();
      return finish({ status: "failed_not_charged", paid: 0n, asked, reason: `request failed after signing (reservation kept for safety): ${err?.message ?? err}` });
    }

    let settle: SettleResponse | undefined;
    const respHeader = paidRes.headers.get("PAYMENT-RESPONSE");
    if (respHeader) {
      try {
        settle = decodePaymentResponseHeader(respHeader);
      } catch {}
    }
    const charged = Boolean(settle?.success);
    const body = await readBody(paidRes);

    if (!paidRes.ok) {
      if (charged) {
        reservation.commit();
        return finish({ status: "paid_output_rejected", paid: asked, asked, txHash: settle!.transaction, reason: `seller settled but returned ${paidRes.status}` });
      }
      reservation.release();
      let msg = typeof body === "object" && body?.error ? body.error : JSON.stringify(body).slice(0, 200);
      const again = paidRes.headers.get("PAYMENT-REQUIRED");
      if (again) {
        try {
          msg = decodePaymentRequiredHeader(again).error ?? msg;
        } catch {}
      }
      // A 402 to a signed request means the payment itself was rejected (e.g. buyer balance), not a seller fault.
      if (paidRes.status === 402) return finish({ status: "failed_not_charged", paid: 0n, asked, reason: `payment rejected: ${msg}` });
      return finish({ status: "failed_not_charged", paid: 0n, asked, reason: `seller returned ${paidRes.status}: ${msg}` });
    }

    reservation.commit();
    const out = validate(service.outputSchema, body);
    if (!out.ok) {
      return finish({ status: "paid_output_rejected", paid: asked, asked, txHash: settle?.transaction, reason: `output breaks listed schema: ${out.error}` });
    }
    return finish({
      status: "paid",
      paid: asked,
      asked,
      data: body,
      txHash: settle?.transaction,
      reason: charged ? undefined : "200 without PAYMENT-RESPONSE header; counted as paid for budget safety",
    });
  }
}
