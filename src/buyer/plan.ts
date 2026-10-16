import { z } from "zod";
import type { ServiceWithReputation } from "../registry/store.js";
import { validateInput } from "../x402/schema.js";
import { findGroup, type ServiceGroup } from "./catalogue.js";
import { referencedNames, RefError, resolveDeep, type Store } from "./refs.js";
import { TOOL_NAMES } from "./tools.js";

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// The model sometimes writes "$p1" where only "p1" is wanted.
const resultName = z.string().transform((s) => s.trim().replace(/^\$/, "")).pipe(z.string().regex(NAME_RE, "names are letters, digits and _ (max 32), starting with a letter"));
const list = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform((v) => v ?? []);

const callSchema = z.object({
  service: z.string().min(1),
  input: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  as: resultName.nullish().transform((v) => v ?? undefined),
  purpose: z.string().nullish().transform((v) => v ?? undefined),
});
const toolSchema = z.object({
  tool: z.enum(TOOL_NAMES),
  as: resultName,
  args: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});
const finalSchema = z.object({
  answer: z.string().trim().min(1),
  outputs: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});
export const roundSchema = z.object({
  calls: list(callSchema),
  tools: list(toolSchema),
  final: finalSchema.nullish().transform((v) => v ?? undefined),
});

export type Round = z.infer<typeof roundSchema>;

/** Pulls the JSON object out of a model reply (tolerates code fences and chatter around it). */
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error("the reply is not JSON");
  }
}

export function parseRound(raw: string): { ok: true; round: Round } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "the reply is not JSON" };
  }
  const parsed = roundSchema.safeParse(json);
  if (parsed.success) return { ok: true, round: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "reply"}: ${i.message}`).join("; ") };
}

export interface ResolvedCall {
  as: string;
  group: ServiceGroup;
  /** Input as the model wrote it; references are resolved when the call becomes ready. */
  rawInput: Record<string, unknown>;
  /** Input with references resolved and coerced to the listed schema; set once every dependency exists. */
  input?: Record<string, unknown>;
  /** Names of results created in this same turn that the input waits for. */
  deps: string[];
  purpose?: string;
}

export interface ToolStep {
  tool: Round["tools"][number]["tool"];
  as: string;
  args: Record<string, unknown>;
  deps: string[];
}

export interface Validated {
  issues: string[];
  calls: ResolvedCall[];
  tools: ToolStep[];
  final?: { answer: string; outputs: Record<string, unknown> };
  /** The model asked for calls/tools and a final answer in one turn; the answer cannot be trusted before the results exist. */
  finalIgnored: boolean;
}

export interface ValidationEnv {
  groups: ServiceGroup[];
  all: ServiceWithReputation[];
  store: Store;
  /** How many more paid calls this run may still make. */
  callsLeft: number;
  /** False until the agent has tried any call or tool; a final answer before that is refused. */
  started?: boolean;
}

/**
 * Everything that can be checked before any money moves: services exist, references resolve, inputs match the listed
 * schema (after coercion), names are free. Returns human-readable issues the model can fix in one repair message.
 */
export function validateRound(round: Round, env: ValidationEnv): Validated {
  const issues: string[] = [];
  const out: Validated = { issues, calls: [], tools: [], finalIgnored: false };

  if (!round.calls.length && !round.tools.length && !round.final) {
    issues.push('the reply has no "calls", no "tools" and no "final"; send at least one');
    return out;
  }
  if (round.final && (round.calls.length || round.tools.length)) out.finalIgnored = true;
  if (round.final && !round.calls.length && !round.tools.length && env.started === false) {
    issues.push("final: nothing has been tried yet. Do not give up in advance: the system enforces the budget and will tell you when a call does not fit. Start with the calls that matter most, then finish with what you have");
  }
  if (round.calls.length > env.callsLeft) issues.push(`too many paid calls: ${round.calls.length} requested but only ${env.callsLeft} are allowed for the rest of this run`);

  const taken = new Set(env.store.keys());
  const thisRound = new Set<string>();
  const claim = (name: string, what: string) => {
    if (taken.has(name) || thisRound.has(name)) issues.push(`${what}: the name "${name}" is already used; pick a new "as" name`);
    thisRound.add(name);
  };

  // Pass 1: give every call and tool a name, so steps can wait for each other within the turn.
  let auto = 1;
  const names = round.calls.map((c) => {
    if (c.as) return c.as;
    while (taken.has(`c${auto}`) || thisRound.has(`c${auto}`)) auto++;
    return `c${auto++}`;
  });
  round.calls.forEach((c, i) => claim(names[i], `call ${i + 1} (${c.service}, as "${names[i]}")`));
  round.tools.forEach((t) => claim(t.as, `tool ${t.tool}`));
  const roundNames = new Set([...names, ...round.tools.map((t) => t.as)]);
  const depsOf = (value: unknown, self: string) => [...referencedNames(value)].filter((n) => roundNames.has(n) && n !== self && !taken.has(n));

  round.calls.forEach((c, i) => {
    const name = names[i];
    const label = `call ${i + 1} (${c.service}, as "${name}")`;
    const group = findGroup(env.groups, c.service, env.all);
    if (!group) {
      issues.push(`${label}: unknown service "${c.service}"; use one of: ${env.groups.map((g) => g.handle).join(", ")}`);
      return;
    }
    const deps = depsOf(c.input, name);
    const call: ResolvedCall = { as: name, group, rawInput: c.input, deps, purpose: c.purpose };
    if (!deps.length) {
      // Everything it needs already exists, so it can be fully checked before any money moves.
      const checked = resolveCallInput(call, env.store);
      if (typeof checked === "string") issues.push(`${label}: ${checked}`);
      else call.input = checked;
    } else {
      const unknown = [...referencedNames(c.input)].filter((n) => !taken.has(n) && !roundNames.has(n));
      if (unknown.length) issues.push(`${label}: refers to ${unknown.map((n) => "$" + n).join(", ")}, which do not exist`);
    }
    out.calls.push(call);
  });

  for (const t of round.tools) {
    const deps = depsOf(t.args, t.as);
    const unknown = [...referencedNames(t.args)].filter((n) => !taken.has(n) && !roundNames.has(n));
    if (unknown.length) issues.push(`tool ${t.tool} "${t.as}" refers to ${unknown.map((n) => "$" + n).join(", ")}, which do not exist`);
    out.tools.push({ tool: t.tool, as: t.as, args: t.args, deps });
  }

  // Steps that wait for each other must not wait in a circle.
  const done = new Set<string>();
  let waiting = [...out.calls, ...out.tools].filter((x) => x.deps.length);
  while (waiting.length) {
    const ready = waiting.filter((x) => x.deps.every((d) => done.has(d) || !waiting.some((w) => w.as === d)));
    if (!ready.length) {
      issues.push(`circular dependency between: ${waiting.map((w) => w.as).join(", ")}`);
      break;
    }
    ready.forEach((r) => done.add(r.as));
    waiting = waiting.filter((w) => !ready.includes(w));
  }

  if (round.final && !out.finalIgnored) {
    try {
      out.final = { answer: round.final.answer, outputs: resolveDeep(round.final.outputs, env.store) as Record<string, unknown> };
    } catch (err) {
      issues.push(`final.outputs: ${err instanceof RefError ? err.message : String(err)}`);
    }
  }
  return out;
}

/** Resolves references in a call's input and coerces it to the listed schema; returns the input, or a message saying what is wrong. */
export function resolveCallInput(call: Pick<ResolvedCall, "group" | "rawInput">, store: Store): Record<string, unknown> | string {
  let input: unknown;
  try {
    input = structuredClone(resolveDeep(call.rawInput, store));
  } catch (err) {
    return err instanceof RefError ? err.message : String(err);
  }
  const check = validateInput(call.group.inputSchema, input);
  return check.ok ? (input as Record<string, unknown>) : `input does not match the service's input schema: ${check.error}`;
}
