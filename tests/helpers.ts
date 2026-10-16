import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { NETWORK, USDC_ADDRESS } from "../src/config.js";
import type { Service } from "../src/registry/store.js";

export const SELLER = "0x1111111111111111111111111111111111111111";
export const OTHER = "0x2222222222222222222222222222222222222222";

export const service = (over: Partial<Service> = {}): Service => ({
  id: "test-fx",
  name: "test-fx",
  category: "data",
  endpoint: "http://seller.test/fx",
  method: "GET",
  price: "1000",
  network: NETWORK,
  asset: USDC_ADDRESS,
  payTo: SELLER,
  inputSchema: { type: "object" },
  outputSchema: { type: "object", required: ["rate"], properties: { rate: { type: "number" } } },
  description: "",
  owner: "external",
  verification: "unchecked",
  verificationNote: "",
  verifiedAt: null,
  ...over,
});

export const accept = (over: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: NETWORK,
  amount: "1000",
  asset: USDC_ADDRESS,
  payTo: SELLER,
  maxTimeoutSeconds: 120,
  extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
  ...over,
});

export const paymentRequired = (a: Record<string, unknown> = accept()): PaymentRequired =>
  ({
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url: "http://seller.test/fx", description: "fx", mimeType: "application/json" },
    accepts: [a],
  }) as any;

/** A 402 response the way a standard x402 v2 seller sends it. */
export const challenge402 = (a: Record<string, unknown> = accept()) =>
  new Response(JSON.stringify(paymentRequired(a)), {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired(a)), "Content-Type": "application/json" },
  });
