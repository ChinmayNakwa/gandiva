import { config } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Minimal Ollama /api/chat client (works with local Ollama or Ollama cloud via OLLAMA_API_KEY). */
export interface ChatOptions {
  json?: boolean;
  timeoutMs?: number;
  temperature?: number;
  /** Another Ollama server (a seller's own). The server-wide API key is never sent there; give apiKey if it needs one. */
  host?: string;
  apiKey?: string;
  model?: string;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const host = (opts.host ?? config.ollama.host).replace(/\/$/, "");
  const apiKey = opts.host ? (opts.apiKey ?? "") : config.ollama.apiKey;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers,
    // A seller-chosen host must not bounce us to an internal address.
    redirect: opts.host ? "error" : "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    body: JSON.stringify({
      model: opts.model ?? config.ollama.model,
      messages,
      stream: false,
      ...(opts.json ? { format: "json" } : {}),
      options: { temperature: opts.temperature ?? 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const content = j?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("ollama returned an empty message");
  return content.trim();
}

export async function llmAvailable(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (config.ollama.apiKey) headers.Authorization = `Bearer ${config.ollama.apiKey}`;
    const res = await fetch(`${config.ollama.host}/api/tags`, { headers, signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
