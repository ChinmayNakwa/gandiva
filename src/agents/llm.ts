import { z } from "zod";
import { config } from "../config.js";
import { decryptSecret, encryptSecret, secretsConfigured, SecretsError } from "../crypto/secrets.js";
import { db } from "../db.js";
import { checkHost, DEFAULT_HOST, HostedError } from "../hosted/agents.js";
import { chat, redactSecret, type PlannerLlm } from "../llm.js";

/**
 * A signed-in user's own Ollama settings for Scout's planning, so their runs use their quota and not the server's.
 * Stored encrypted like the Sell-tab agents' keys; the key is never sent back to the browser.
 */
const form = z.object({
  host: z.string().trim().default(DEFAULT_HOST),
  model: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\w.:/-]+$/, "model may only contain letters, numbers and . : / _ -")
    .optional(),
  apiKey: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((k) => k || undefined),
});

export interface PlannerLlmInfo {
  host: string;
  model: string;
  hasKey: boolean;
}

const row = (address: string) =>
  db.prepare("SELECT llm_host, llm_model, llm_key_enc FROM users WHERE address = ?").get(address.toLowerCase()) as
    | { llm_host: string | null; llm_model: string | null; llm_key_enc: string | null }
    | undefined;

/** What the browser may see: never the key. null = the user has none saved (their runs use the server's). */
export function plannerLlmInfo(address: string): PlannerLlmInfo | null {
  const r = row(address);
  if (!r?.llm_host || !r.llm_model) return null;
  return { host: r.llm_host, model: r.llm_model, hasKey: Boolean(r.llm_key_enc) };
}

/** The settings a run must plan with, or undefined when the user saved none. Fails loudly rather than quietly using the server's key. */
export async function resolvePlannerLlm(address: string): Promise<PlannerLlm | undefined> {
  const r = row(address);
  if (!r?.llm_host || !r.llm_model) return undefined;
  let apiKey = "";
  try {
    apiKey = r.llm_key_enc ? decryptSecret(r.llm_key_enc) : "";
  } catch (err) {
    throw new HostedError(err instanceof SecretsError ? "Your saved Ollama key cannot be read; save it again on the Run page." : "Your saved Ollama key cannot be read.", 409);
  }
  try {
    await checkHost(r.llm_host);
  } catch (err: any) {
    throw new HostedError(`Your saved Ollama host is not allowed any more: ${err.message}`, 409);
  }
  return { host: r.llm_host, model: r.llm_model, apiKey };
}

const SAVE_LIMIT = 20;
const SAVE_WINDOW_MS = 3_600_000;
const saveLog = new Map<string, number[]>();

/** Checks the settings with one tiny call, then saves them. Nothing is stored if the call fails. */
export async function savePlannerLlm(raw: unknown, address: string, now = Date.now()): Promise<PlannerLlmInfo> {
  if (!secretsConfigured()) throw new HostedError("this server has no SECRETS_KEY, so it cannot store API keys yet", 503);
  const f = form.parse(raw);
  const who = address.toLowerCase();
  const recent = (saveLog.get(who) ?? []).filter((t) => now - t < SAVE_WINDOW_MS);
  if (recent.length >= SAVE_LIMIT) throw new HostedError(`at most ${SAVE_LIMIT} saves per hour`, 429);
  saveLog.set(who, [...recent, now]);

  const host = await checkHost(f.host);
  const previous = row(who);
  const model = f.model ?? previous?.llm_model ?? config.ollama.model;
  const keyEnc = f.apiKey ? encryptSecret(f.apiKey) : (previous?.llm_key_enc ?? null);
  if (!keyEnc && host === DEFAULT_HOST) throw new HostedError("Ollama cloud needs your API key (ollama.com/settings/keys)");
  const apiKey = f.apiKey ?? (keyEnc ? decryptSecret(keyEnc) : "");
  try {
    await chat([{ role: "user", content: "Reply with the single word: ok" }], { host, apiKey, model, timeoutMs: 20_000, temperature: 0 });
  } catch (err: any) {
    throw new HostedError(`That Ollama key or model did not work: ${redactSecret(String(err?.message ?? err), apiKey).slice(0, 200)}`, 400);
  }
  db.prepare("UPDATE users SET llm_host = ?, llm_model = ?, llm_key_enc = ? WHERE address = ?").run(host, model, keyEnc, who);
  return { host, model, hasKey: Boolean(keyEnc) };
}

export function clearPlannerLlm(address: string): void {
  db.prepare("UPDATE users SET llm_host = NULL, llm_model = NULL, llm_key_enc = NULL WHERE address = ?").run(address.toLowerCase());
}
