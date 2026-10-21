import { Ajv, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;
addFormats(ajv);

// Query-string inputs arrive as strings, so input validation coerces types ("2" -> 2) in place.
const coercingAjv = new Ajv({ allErrors: true, strict: false, coerceTypes: true, useDefaults: true });
addFormats(coercingAjv);

const cache = new Map<string, ValidateFunction>();

/**
 * True for a regex with a group that repeats without bound while its body repeats or branches, like (a+)+ or (a|aa)*.
 * Those backtrack for minutes on a 40-character input, and validation runs on the main thread before any payment.
 */
// shortcut: catches nested repetition only, not polynomial cases like .*.*.*x; use an RE2-backed Ajv `code.regExp` if that matters.
export function riskyPattern(p: string): boolean {
  const open: boolean[] = []; // per open group: does its body repeat or branch?
  const repeats = (i: number) => p[i] === "*" || p[i] === "+" || p[i] === "?" || /^\{\d+(,\d*)?\}/.test(p.slice(i));
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") i++;
    else if (c === "[") {
      for (i++; i < p.length && p[i] !== "]"; i++) if (p[i] === "\\") i++;
    } else if (c === "(") open.push(false);
    else if (c === ")") {
      const inner = open.pop() ?? false;
      const unbounded = p[i + 1] === "*" || p[i + 1] === "+" || /^\{\d+,\}/.test(p.slice(i + 1));
      if (inner && unbounded) return true;
      if (open.length && (inner || repeats(i + 1))) open[open.length - 1] = true;
    } else if (open.length && (c === "|" || (repeats(i) && p[i - 1] !== "("))) open[open.length - 1] = true;
  }
  return false;
}

/** Any `pattern` or `patternProperties` key in a JSON schema that riskyPattern flags. */
export function hasRiskyPattern(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(hasRiskyPattern);
  if (!schema || typeof schema !== "object") return false;
  return Object.entries(schema).some(
    ([k, v]) => (k === "pattern" && typeof v === "string" && riskyPattern(v)) || (k === "patternProperties" && !!v && typeof v === "object" && Object.keys(v).some(riskyPattern)) || hasRiskyPattern(v),
  );
}
export const RISKY_PATTERN = "schema has a regex pattern with nested repetition (like (a+)+), which can hang the server; simplify it";

function check(instance: Ajv, tag: string, schema: Record<string, unknown>, data: unknown): { ok: true } | { ok: false; error: string } {
  const key = tag + JSON.stringify(schema);
  let fn = cache.get(key);
  if (!fn) {
    if (hasRiskyPattern(schema)) return { ok: false, error: RISKY_PATTERN };
    fn = instance.compile(schema);
    cache.set(key, fn);
  }
  if (fn(data)) return { ok: true };
  return { ok: false, error: instance.errorsText(fn.errors, { separator: "; " }) };
}

export const validate = (schema: Record<string, unknown>, data: unknown) => check(ajv, "strict:", schema, data);
export const validateInput = (schema: Record<string, unknown>, data: unknown) => check(coercingAjv, "coerce:", schema, data);
