import type { Context } from "hono";
import { z } from "zod";
import { config, MAX_PRICE_UNITS } from "../config.js";
import { decryptSecret, encryptSecret, secretsConfigured, SecretsError } from "../crypto/secrets.js";
import { db } from "../db.js";
import { chat } from "../llm.js";
import { endpointBlockedReason } from "../registry/probe.js";
import { getService, registerForWallet, slug, walletOwner, type Service } from "../registry/store.js";
import { paidRoute, ServiceError } from "../x402/paidRoute.js";

export const DEFAULT_HOST = "https://ollama.com";
export const MAX_TEXT_CHARS = 4000;
export const MAX_ANSWER_CHARS = 20_000;
export const MAX_PROMPT_CHARS = 4000;
const CALL_TIMEOUT_MS = 40_000;

/** A form problem the seller can fix (status says which kind). */
export class HostedError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 429 | 502 | 503 = 400,
  ) {
    super(message);
  }
}

export interface HostedAgent {
  serviceId: string;
  /** Wallet that owns the listing (lower case). */
  owner: string;
  host: string;
  model: string;
  systemPrompt: string;
  /** Encrypted API key, or null when the host needs none. */
  apiKeyEnc: string | null;
}

const rowToAgent = (r: any): HostedAgent => ({ serviceId: r.service_id, owner: r.owner, host: r.host, model: r.model, systemPrompt: r.system_prompt, apiKeyEnc: r.api_key_enc });

export const getHosted = (serviceId: string): HostedAgent | undefined => {
  const r = db.prepare("SELECT * FROM hosted_sellers WHERE service_id = ?").get(serviceId);
  return r ? rowToAgent(r) : undefined;
};

/** What the Sell tab may show about a wallet's agents. Never the key. */
export function listHostedFor(wallet: string): Record<string, { host: string; model: string; systemPrompt: string; hasKey: boolean }> {
  const rows = db.prepare("SELECT * FROM hosted_sellers WHERE owner = ?").all(wallet.toLowerCase()).map(rowToAgent);
  return Object.fromEntries(rows.map((a) => [a.serviceId, { host: a.host, model: a.model, systemPrompt: a.systemPrompt, hasKey: Boolean(a.apiKeyEnc) }]));
}

/** The fixed request/answer shape of every LLM agent. The description is in the schema so each agent is its own kind of job to a buyer. */
export const agentInputSchema = (description: string) => ({
  type: "object",
  properties: { text: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS, description: description.slice(0, 400) } },
  required: ["text"],
  additionalProperties: false,
});
export const agentOutputSchema = {
  type: "object",
  required: ["answer", "model"],
  properties: { answer: { type: "string", minLength: 1, maxLength: MAX_ANSWER_CHARS }, model: { type: "string" } },
};

const modelSettings = {
  host: z.string().trim().default(DEFAULT_HOST),
  model: z.string().trim().min(1).max(80).regex(/^[\w.:/-]+$/, "model may only contain letters, numbers and . : / _ -"),
  systemPrompt: z.string().trim().min(1, "write a system prompt").max(MAX_PROMPT_CHARS, `system prompt can be at most ${MAX_PROMPT_CHARS} characters`),
  apiKey: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((k) => k || undefined),
};

const agentForm = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,64}$/).optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(10, "describe what the agent is good for (at least 10 characters); buyer agents read it").max(400),
  price: z
    .string()
    .regex(/^\d+$/, "price is in USDC smallest units")
    .refine((p) => BigInt(p) > 0n && BigInt(p) <= MAX_PRICE_UNITS, "price must be > 0 and <= 100000 (0.10 USDC)"),
  ...modelSettings,
});

/** A model host must be a public https origin, checked again on every call (DNS can change). */
export async function checkHost(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HostedError("host must be a URL like https://ollama.com");
  }
  if (url.protocol !== "https:") throw new HostedError("host must use https");
  const blocked = await endpointBlockedReason(url.origin, false);
  if (blocked) throw new HostedError(`host not allowed: ${blocked.replace("endpoint", "host")}`);
  return url.origin;
}

const redact = (text: string, secret: string) => (secret ? text.split(secret).join("***") : text);

/** One model call with the seller's settings. Throws ServiceError so a failed call is never charged. */
export async function askModel(a: Pick<HostedAgent, "host" | "model" | "systemPrompt" | "apiKeyEnc">, text: string): Promise<{ answer: string; model: string }> {
  try {
    await checkHost(a.host);
  } catch (err: any) {
    throw new ServiceError(`seller's model host is not allowed: ${err.message}`, 502);
  }
  let apiKey = "";
  try {
    apiKey = a.apiKeyEnc ? decryptSecret(a.apiKeyEnc) : "";
  } catch (err) {
    throw new ServiceError(err instanceof SecretsError ? "seller's API key cannot be read; the seller must save it again" : "seller's API key cannot be read", 502);
  }
  let answer: string;
  try {
    answer = await chat(
      [
        { role: "system", content: a.systemPrompt },
        { role: "user", content: text },
      ],
      { host: a.host, apiKey, model: a.model, timeoutMs: CALL_TIMEOUT_MS, temperature: 0.2 },
    );
  } catch (err: any) {
    throw new ServiceError(`model unavailable: ${redact(String(err?.message ?? err), apiKey).slice(0, 200)}`, 502);
  }
  return { answer: answer.slice(0, MAX_ANSWER_CHARS), model: a.model };
}

/** POST /sellers/u/:id/ask: the paid x402 route of one hosted agent, built from its stored settings on every request. */
export async function hostedRoute(c: Context) {
  const id = c.req.param("id") ?? "";
  const service = getService(id);
  const agent = getHosted(id);
  if (!service || !agent || service.owner !== walletOwner(agent.owner)) return c.json({ error: "no such agent" }, 404);
  const route = paidRoute<{ text: string }, { answer: string; model: string }>({
    seller: id,
    description: service.description,
    price: BigInt(service.price),
    payTo: service.payTo,
    inputSchema: service.inputSchema,
    outputSchema: service.outputSchema,
    handler: (input) => askModel(agent, input.text),
  });
  return route(c);
}

/** Creates or updates the signed-in wallet's LLM agent listing. */
export async function saveAgent(raw: unknown, wallet: string): Promise<{ service: Service; hasKey: boolean }> {
  if (!secretsConfigured()) throw new HostedError("this server has no SECRETS_KEY, so it cannot store API keys yet", 503);
  const f = agentForm.parse(raw);
  const host = await checkHost(f.host);
  const id = f.id ?? slug(f.name);
  const owner = walletOwner(wallet);
  const existing = getService(id);
  const previous = existing?.owner === owner ? getHosted(id) : undefined;
  if (existing?.owner === owner && !previous) throw new HostedError(`"${id}" is already one of your custom-endpoint listings; choose another name`, 409);

  let apiKeyEnc = previous?.apiKeyEnc ?? null;
  if (f.apiKey) apiKeyEnc = encryptSecret(f.apiKey);
  if (!apiKeyEnc && host === DEFAULT_HOST) throw new HostedError("Ollama cloud needs your API key (ollama.com/settings/keys)");

  const service = registerForWallet(
    {
      id,
      name: f.name,
      category: "inference",
      endpoint: `${config.publicBaseUrl}/sellers/u/${id}/ask`,
      method: "POST",
      price: f.price,
      description: f.description,
      inputSchema: agentInputSchema(f.description),
      outputSchema: agentOutputSchema,
    },
    wallet,
  );
  db.prepare(
    `INSERT INTO hosted_sellers (service_id, owner, host, model, system_prompt, api_key_enc) VALUES (?,?,?,?,?,?)
     ON CONFLICT(service_id) DO UPDATE SET host=excluded.host, model=excluded.model, system_prompt=excluded.system_prompt, api_key_enc=excluded.api_key_enc`,
  ).run(service.id, wallet.toLowerCase(), host, f.model, f.systemPrompt, apiKeyEnc);
  return { service, hasKey: Boolean(apiKeyEnc) };
}

const testForm = z.object({ id: z.string().optional(), text: z.string().trim().min(1).max(MAX_TEXT_CHARS), ...modelSettings });
const TEST_LIMIT = 20;
const TEST_WINDOW_MS = 3_600_000;
const testLog = new Map<string, number[]>();

/** Free, owner-only trial run of the settings in the form (nothing is listed or paid). Rate-limited per wallet. */
export async function testAgent(raw: unknown, wallet: string, now = Date.now()): Promise<{ answer: string; model: string; ms: number }> {
  if (!secretsConfigured()) throw new HostedError("this server has no SECRETS_KEY, so it cannot handle API keys yet", 503);
  const f = testForm.parse(raw);
  const recent = (testLog.get(wallet) ?? []).filter((t) => now - t < TEST_WINDOW_MS);
  if (recent.length >= TEST_LIMIT) throw new HostedError(`at most ${TEST_LIMIT} test calls per hour`, 429);
  testLog.set(wallet, [...recent, now]);

  const host = await checkHost(f.host);
  const stored = f.id && getService(f.id)?.owner === walletOwner(wallet) ? getHosted(f.id) : undefined;
  const apiKeyEnc = f.apiKey ? encryptSecret(f.apiKey) : (stored?.apiKeyEnc ?? null);
  if (!apiKeyEnc && host === DEFAULT_HOST) throw new HostedError("Ollama cloud needs your API key (ollama.com/settings/keys)");
  const started = Date.now();
  try {
    const out = await askModel({ host, model: f.model, systemPrompt: f.systemPrompt, apiKeyEnc }, f.text);
    return { ...out, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof ServiceError) throw new HostedError(err.message.replace(/^model unavailable: /, "The model host answered with an error: "), 502);
    throw err;
  }
}
