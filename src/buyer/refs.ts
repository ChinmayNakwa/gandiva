/**
 * References let the LLM point at earlier results instead of copying them: "$books[0:2].description".
 * Syntax after $name: .field  [n]  [-n]  [a:b]  [*]. A field applied to an array maps over its items.
 */
export class RefError extends Error {}

export type Store = Map<string, unknown>;

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const PATH_TOKEN = `(?:\\.${NAME}|\\[-?\\d+\\]|\\[-?\\d*:-?\\d*\\]|\\[\\*\\])`;
export const REF_SOURCE = `\\$${NAME}${PATH_TOKEN}*`;
const REF_RE = new RegExp(`^${REF_SOURCE}$`);
const TOKEN_RE = new RegExp(`\\.(${NAME})|\\[(-?\\d+)\\]|\\[(-?\\d*):(-?\\d*)\\]|\\[\\*\\]`, "y");

export const isRef = (v: unknown): v is string => typeof v === "string" && REF_RE.test(v);

const describeKeys = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).slice(0, 12).join(", ") : "");

export function resolveRef(ref: string, store: Store): unknown {
  if (!isRef(ref)) throw new RefError(`"${ref}" is not a valid reference`);
  const name = ref.match(new RegExp(`^\\$(${NAME})`))![1];
  if (!store.has(name)) throw new RefError(`${ref}: no result named "${name}" (available: ${[...store.keys()].join(", ") || "none yet"})`);
  let cur: unknown = store.get(name);
  const path = ref.slice(name.length + 1);
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < path.length) {
    const m = TOKEN_RE.exec(path)!;
    const [token, field, index, from, to] = m;
    if (field !== undefined) {
      if (Array.isArray(cur)) {
        cur = cur.map((item, i) => {
          if (item === null || typeof item !== "object" || !(field in (item as object))) throw new RefError(`${ref}: item ${i} has no field "${field}"`);
          return (item as Record<string, unknown>)[field];
        });
      } else {
        if (cur === null || typeof cur !== "object" || !(field in (cur as object))) {
          const keys = describeKeys(cur);
          throw new RefError(`${ref}: no field "${field}"${keys ? ` (available: ${keys})` : ""}`);
        }
        cur = (cur as Record<string, unknown>)[field];
      }
    } else if (index !== undefined) {
      if (!Array.isArray(cur)) throw new RefError(`${ref}: ${token} needs a list but the value is ${typeof cur}`);
      const i = Number(index) < 0 ? cur.length + Number(index) : Number(index);
      if (i < 0 || i >= cur.length) throw new RefError(`${ref}: index ${index} is out of range (the list has ${cur.length} item${cur.length === 1 ? "" : "s"})`);
      cur = cur[i];
    } else if (from !== undefined) {
      if (!Array.isArray(cur)) throw new RefError(`${ref}: ${token} needs a list but the value is ${typeof cur}`);
      cur = cur.slice(from === "" ? undefined : Number(from), to === "" ? undefined : Number(to));
    } else {
      if (!Array.isArray(cur)) throw new RefError(`${ref}: [*] needs a list but the value is ${typeof cur}`);
    }
  }
  return cur;
}

/** Replaces every string that is exactly a reference, at any depth; other values pass through unchanged. */
export function resolveDeep(value: unknown, store: Store): unknown {
  if (typeof value === "string") return isRef(value) ? resolveRef(value, store) : value;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, store));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, store)]));
  return value;
}

/** Names of results mentioned anywhere in a value, either as whole-string references or inside expressions. */
export function referencedNames(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(new RegExp(`\\$(${NAME})`, "g"))) into.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => referencedNames(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => referencedNames(v, into));
  return into;
}
