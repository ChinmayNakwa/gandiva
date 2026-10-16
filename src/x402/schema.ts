import { Ajv, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;
addFormats(ajv);

// Query-string inputs arrive as strings, so input validation coerces types ("2" -> 2) in place.
const coercingAjv = new Ajv({ allErrors: true, strict: false, coerceTypes: true, useDefaults: true });
addFormats(coercingAjv);

const cache = new Map<string, ValidateFunction>();

function check(instance: Ajv, tag: string, schema: Record<string, unknown>, data: unknown): { ok: true } | { ok: false; error: string } {
  const key = tag + JSON.stringify(schema);
  let fn = cache.get(key);
  if (!fn) {
    fn = instance.compile(schema);
    cache.set(key, fn);
  }
  if (fn(data)) return { ok: true };
  return { ok: false, error: instance.errorsText(fn.errors, { separator: "; " }) };
}

export const validate = (schema: Record<string, unknown>, data: unknown) => check(ajv, "strict:", schema, data);
export const validateInput = (schema: Record<string, unknown>, data: unknown) => check(coercingAjv, "coerce:", schema, data);
