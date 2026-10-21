import type { Context } from "hono";
import { z } from "zod";
import { config, MAX_PRICE_UNITS } from "../config.js";
import { encryptSecret, secretsConfigured } from "../crypto/secrets.js";
import { db } from "../db.js";
import { CATEGORIES, deleteService, getService, listByOwner, MAX_LISTINGS_PER_WALLET, RegistryError, registerForWallet, slug, walletOwner, type Service } from "../registry/store.js";
import { paidRoute, ServiceError } from "../x402/paidRoute.js";
import { hasRiskyPattern, validateInput } from "../x402/schema.js";
import { callRemoteTool, checkMcpUrl, listRemoteTools, MAX_TEXT_OUT, MAX_TOOLS_PER_SERVER, McpSellerError, readToken, type RemoteTool, type ToolAnswer } from "./client.js";

const MAX_SCHEMA_BYTES = 8000;
const MAX_SCHEMA_DESCRIPTION = 500;
const MAX_LISTING_DESCRIPTION = 400;

export interface McpToolRow {
  serviceId: string;
  /** Wallet that owns the listing (lower case). */
  owner: string;
  serverId: string;
  url: string;
  /** Encrypted bearer token, or null when the server needs none. */
  tokenEnc: string | null;
  toolName: string;
}

const rowToTool = (r: any): McpToolRow => ({ serviceId: r.service_id, owner: r.owner, serverId: r.server_id, url: r.url, tokenEnc: r.token_enc, toolName: r.tool_name });

export const getMcpTool = (serviceId: string): McpToolRow | undefined => {
  const r = db.prepare("SELECT * FROM mcp_sellers WHERE service_id = ?").get(serviceId);
  return r ? rowToTool(r) : undefined;
};
export const isMcpService = (serviceId: string): boolean => Boolean(db.prepare("SELECT 1 FROM mcp_sellers WHERE service_id = ?").get(serviceId));

const rowsFor = (wallet: string, serverId: string): McpToolRow[] => db.prepare("SELECT * FROM mcp_sellers WHERE owner = ? AND server_id = ?").all(wallet.toLowerCase(), serverId).map(rowToTool);

/** What the Sell tab may show about a wallet's MCP listings. Never the token. */
export function listMcpFor(wallet: string): Record<string, { serverId: string; url: string; tool: string; hasToken: boolean }> {
  const rows = db.prepare("SELECT * FROM mcp_sellers WHERE owner = ?").all(wallet.toLowerCase()).map(rowToTool);
  return Object.fromEntries(rows.map((r) => [r.serviceId, { serverId: r.serverId, url: r.url, tool: r.toolName, hasToken: Boolean(r.tokenEnc) }]));
}

/** The token this wallet already saved for exactly this URL. A token is never carried over to a different URL. */
const savedTokenFor = (wallet: string, url: string): string | null => {
  const r = db.prepare("SELECT token_enc FROM mcp_sellers WHERE owner = ? AND url = ? AND token_enc IS NOT NULL LIMIT 1").get(wallet.toLowerCase(), url) as { token_enc: string } | undefined;
  return r?.token_enc ?? null;
};

/** Every MCP tool answers in this shape. */
export const mcpOutputSchema = {
  type: "object",
  required: ["text"],
  properties: { text: { type: "string", minLength: 1, maxLength: MAX_TEXT_OUT }, structuredContent: { type: "object" } },
};

const form = {
  url: z.string().trim().min(1, "enter the MCP server URL").max(500),
  token: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((k) => k || undefined),
};
const loadForm = z.object(form);
const saveForm = z.object({
  ...form,
  name: z.string().trim().min(1).max(40).optional(),
  category: z.enum(CATEGORIES),
  price: z
    .string()
    .regex(/^\d+$/, "price is in USDC smallest units")
    .refine((p) => BigInt(p) > 0n && BigInt(p) <= MAX_PRICE_UNITS, "price must be > 0 and <= 100000 (0.10 USDC)"),
});

/** "https://mcp.example.co.uk/x" -> "example": the name a listing group gets when the seller gives none. */
export function defaultServerName(url: string): string {
  const labels = new URL(url).hostname.split(".").filter((l) => l && !["www", "mcp", "api"].includes(l));
  const name = slug(labels.length > 1 ? labels[labels.length - 2] : (labels[0] ?? "mcp"));
  return name.length >= 2 ? name : "mcp";
}

/** The schema as the registry stores it: cut descriptions, no `$schema`, always an object, and it must compile. Null = not sellable. */
function cleanSchema(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return { type: "object", properties: {} };
  const walk = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(walk)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "description" && typeof x === "string" ? x.slice(0, MAX_SCHEMA_DESCRIPTION) : walk(x)]))
        : v;
  const schema = walk(raw) as Record<string, unknown>;
  delete schema.$schema;
  delete schema.$id;
  schema.type = "object";
  if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES || hasRiskyPattern(schema)) return null;
  try {
    validateInput(schema, {});
  } catch {
    return null;
  }
  return schema;
}

export interface SavedServer {
  serverId: string;
  name: string;
  url: string;
  listed: Service[];
  skipped: { tool: string; reason: string }[];
  removed: string[];
  hasToken: boolean;
}

const TRIAL_LIMIT = 20;
const TRIAL_WINDOW_MS = 3_600_000;
const trialLog = new Map<string, number[]>();
/** For tests: forget every wallet's recent server checks. */
export const resetServerChecks = () => trialLog.clear();
/** Reaching a remote server is rate-limited per wallet: "Load tools" and every save count. */
function countTrial(wallet: string, now: number) {
  const recent = (trialLog.get(wallet) ?? []).filter((t) => now - t < TRIAL_WINDOW_MS);
  if (recent.length >= TRIAL_LIMIT) throw new McpSellerError(`at most ${TRIAL_LIMIT} server checks per hour`, 429);
  trialLog.set(wallet, [...recent, now]);
}

const needSecrets = (token: string | undefined) => {
  if (token && !secretsConfigured()) throw new McpSellerError("this server has no SECRETS_KEY, so it cannot store tokens yet", 503);
};

/** Free, owner-only look at a server's tools (nothing is listed or paid). */
export async function loadTools(raw: unknown, wallet: string, now = Date.now()): Promise<{ url: string; name: string; hasToken: boolean; tools: { name: string; description: string; usable: boolean }[] }> {
  const f = loadForm.parse(raw);
  needSecrets(f.token);
  countTrial(wallet, now);
  const url = await checkMcpUrl(f.url);
  const savedEnc = f.token ? null : savedTokenFor(wallet, url);
  const tools = await listRemoteTools(url, f.token ?? readToken(savedEnc));
  return {
    url,
    name: defaultServerName(url),
    hasToken: Boolean(f.token ?? savedEnc),
    tools: tools.map((t) => ({ name: t.name, description: (t.description ?? t.title ?? "").slice(0, 200), usable: cleanSchema(t.inputSchema) !== null })),
  };
}

/**
 * Lists every tool of the seller's MCP server as its own paid listing (paid to the signed-in wallet).
 * Saving the same URL again refreshes the tools: new ones are added, ones the server dropped are removed.
 */
export async function saveServer(raw: unknown, wallet: string, now = Date.now()): Promise<SavedServer> {
  const f = saveForm.parse(raw);
  needSecrets(f.token);
  countTrial(wallet, now);
  const url = await checkMcpUrl(f.url);
  const owner = walletOwner(wallet);
  const name = f.name ?? defaultServerName(url);
  const serverId = slug(name).slice(0, 30);
  if (serverId.length < 2) throw new McpSellerError("server name must contain letters or numbers");

  const tokenEnc = f.token ? encryptSecret(f.token) : savedTokenFor(wallet, url);
  const remote = await listRemoteTools(url, f.token ?? readToken(tokenEnc));
  if (!remote.length) throw new McpSellerError("that MCP server has no tools to sell");

  const previous = rowsFor(wallet, serverId);
  const previousIds = new Set(previous.map((r) => r.serviceId));
  const skipped: SavedServer["skipped"] = [];
  const candidates: { id: string; tool: RemoteTool; schema: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  for (const tool of remote.slice(0, MAX_TOOLS_PER_SERVER * 2)) {
    const id = slug(`${serverId}-${tool.name}`);
    if (seen.has(id)) {
      skipped.push({ tool: tool.name, reason: "its name clashes with another tool of this server" });
      continue;
    }
    seen.add(id);
    const schema = cleanSchema(tool.inputSchema);
    if (!schema) skipped.push({ tool: tool.name, reason: "its input description is too large or not supported" });
    else candidates.push({ id, tool, schema });
  }
  for (const t of remote.slice(MAX_TOOLS_PER_SERVER * 2)) skipped.push({ tool: t.name, reason: "the server has more tools than we list" });

  // Tools that are already listed come first, so a refresh never drops a working listing in favour of a new one.
  candidates.sort((a, b) => Number(previousIds.has(b.id)) - Number(previousIds.has(a.id)));
  const room = Math.min(MAX_TOOLS_PER_SERVER, MAX_LISTINGS_PER_WALLET - listByOwner(wallet).length + previousIds.size);

  const listed: Service[] = [];
  for (const { id, tool, schema } of candidates) {
    if (listed.length >= room) {
      skipped.push({ tool: tool.name, reason: `listing limit reached (${MAX_LISTINGS_PER_WALLET} per wallet)` });
      continue;
    }
    const existing = getService(id);
    if (existing && existing.owner === owner && !previousIds.has(id)) {
      skipped.push({ tool: tool.name, reason: `"${id}" is already one of your other listings` });
      continue;
    }
    try {
      const host = new URL(url).hostname;
      const about = (tool.description ?? tool.title ?? tool.name).replace(/\s+/g, " ").trim();
      // One transaction, so a listing never exists without the row that says which tool it calls.
      const service = db.transaction(() => {
        const s = registerForWallet(
          {
            id,
            name: `${name}: ${tool.title ?? tool.name}`.slice(0, 80),
            category: f.category,
            endpoint: `${config.publicBaseUrl}/sellers/u/${id}/call`,
            method: "POST",
            price: f.price,
            description: `${about.slice(0, MAX_LISTING_DESCRIPTION)} (MCP tool from ${host})`.slice(0, 500),
            inputSchema: schema,
            outputSchema: mcpOutputSchema,
          },
          wallet,
        );
        db.prepare(
          `INSERT INTO mcp_sellers (service_id, owner, server_id, url, token_enc, tool_name) VALUES (?,?,?,?,?,?)
           ON CONFLICT(service_id) DO UPDATE SET server_id=excluded.server_id, url=excluded.url, token_enc=excluded.token_enc, tool_name=excluded.tool_name`,
        ).run(s.id, wallet.toLowerCase(), serverId, url, tokenEnc, tool.name);
        return s;
      })();
      listed.push(service);
    } catch (err) {
      if (!(err instanceof RegistryError)) throw err;
      skipped.push({ tool: tool.name, reason: err.message });
    }
  }
  if (!listed.length) throw new McpSellerError(`none of the tools could be listed: ${skipped.map((s) => `${s.tool} (${s.reason})`).join("; ").slice(0, 300)}`);

  // Tools the server no longer offers are taken off the marketplace; tools only skipped this time stay as they are.
  const offered = new Set(remote.map((t) => slug(`${serverId}-${t.name}`)));
  const removed = previous.filter((r) => !offered.has(r.serviceId)).map((r) => r.serviceId);
  for (const id of removed) deleteService(id);
  db.prepare("UPDATE mcp_sellers SET url = ?, token_enc = ? WHERE owner = ? AND server_id = ?").run(url, tokenEnc, wallet.toLowerCase(), serverId);
  return { serverId, name, url, listed, skipped, removed, hasToken: Boolean(tokenEnc) };
}

/** One paid call to the seller's tool, with the seller's stored URL and token. Throws ServiceError so a failed call is never charged. */
export async function runMcpTool(row: McpToolRow, input: Record<string, unknown>): Promise<ToolAnswer> {
  let url: string;
  try {
    url = await checkMcpUrl(row.url);
  } catch (err: any) {
    throw new ServiceError(`seller's MCP server is not allowed: ${err.message}`, 502);
  }
  let token: string;
  try {
    token = readToken(row.tokenEnc);
  } catch (err: any) {
    throw new ServiceError(`seller's ${err.message}`, 502);
  }
  return callRemoteTool(url, token, row.toolName, input);
}

/** POST /sellers/u/:id/call: the paid x402 route of one MCP-tool listing, built from its stored settings on every request. */
export async function mcpToolRoute(c: Context) {
  const id = c.req.param("id") ?? "";
  const service = getService(id);
  const row = getMcpTool(id);
  if (!service || !row || service.owner !== walletOwner(row.owner)) return c.json({ error: "no such tool" }, 404);
  const route = paidRoute<Record<string, unknown>, ToolAnswer>({
    seller: id,
    description: service.description,
    price: BigInt(service.price),
    payTo: service.payTo,
    inputSchema: service.inputSchema,
    outputSchema: service.outputSchema,
    handler: (input) => runMcpTool(row, input),
  });
  return route(c);
}
