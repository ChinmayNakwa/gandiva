import { isRef, REF_SOURCE, resolveDeep, resolveRef, type Store } from "./refs.js";

/** Free, deterministic helpers the agent can call between paid calls: filtering, sorting, arithmetic. No network, no money. */
export class ToolError extends Error {}

export const TOOL_NAMES = ["select", "calc"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

// ---- arithmetic -----------------------------------------------------------------------------------------------------

const TOKEN = new RegExp(`\\s*(?:(\\d+(?:\\.\\d+)?)|(${REF_SOURCE})|([A-Za-z_][A-Za-z0-9_]*)|([-+*/(),]))`, "y");

function tokenise(expr: string) {
  const out: { kind: "num" | "ref" | "ident" | "op"; text: string }[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < expr.length) {
    if (/^\s*$/.test(expr.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(expr);
    if (!m) throw new ToolError(`cannot read "${expr.slice(pos).trim().slice(0, 20)}" in expression "${expr}"`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ kind: "num", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "ref", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "ident", text: m[3] });
    else out.push({ kind: "op", text: m[4] });
  }
  return out;
}

function toNumber(v: unknown, what: string): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ToolError(`${what} is not a number (got ${JSON.stringify(v)?.slice(0, 40)})`);
  return n;
}

/** Small recursive-descent evaluator: + - * / ( ) round(x, digits), numbers, $references and field names of the current item. */
export function evalExpr(expr: unknown, store: Store, item?: Record<string, unknown>): number {
  if (typeof expr === "number") return expr;
  if (typeof expr !== "string") throw new ToolError("expression must be a string");
  const toks = tokenise(expr);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (t: string) => {
    if (take()?.text !== t) throw new ToolError(`expected "${t}" in expression "${expr}"`);
  };

  function factor(): number {
    const t = take();
    if (!t) throw new ToolError(`expression "${expr}" ends too early`);
    if (t.kind === "op" && t.text === "-") return -factor();
    if (t.kind === "op" && t.text === "(") {
      const v = sum();
      expect(")");
      return v;
    }
    if (t.kind === "num") return Number(t.text);
    if (t.kind === "ref") return toNumber(resolveRef(t.text, store), t.text);
    if (t.kind === "ident") {
      if (t.text === "round" && peek()?.text === "(") {
        take();
        const v = sum();
        let digits = 2;
        if (peek()?.text === ",") {
          take();
          digits = sum();
        }
        expect(")");
        const f = 10 ** Math.min(Math.max(Math.trunc(digits), 0), 8);
        return Math.round(v * f) / f;
      }
      if (!item || !(t.text in item)) throw new ToolError(`unknown name "${t.text}" in expression "${expr}"${item ? ` (item fields: ${Object.keys(item).join(", ")})` : ""}`);
      return toNumber(item[t.text], `field ${t.text}`);
    }
    throw new ToolError(`unexpected "${t.text}" in expression "${expr}"`);
  }
  function product(): number {
    let v = factor();
    while (peek()?.text === "*" || peek()?.text === "/") {
      const op = take().text;
      const r = factor();
      if (op === "/" && r === 0) throw new ToolError(`division by zero in "${expr}"`);
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek()?.text === "+" || peek()?.text === "-") v = take().text === "+" ? v + product() : v - product();
    return v;
  }
  const result = sum();
  if (i < toks.length) throw new ToolError(`unexpected "${toks[i].text}" in expression "${expr}"`);
  if (!Number.isFinite(result)) throw new ToolError(`expression "${expr}" did not produce a number`);
  return result;
}

// ---- select ---------------------------------------------------------------------------------------------------------

const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"] as const;
export type SelectOp = (typeof OPS)[number];

const looseEqual = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : String(a).toLowerCase() === String(b).toLowerCase());

function matches(item: Record<string, unknown>, w: { field: string; op: SelectOp; value: unknown }): boolean {
  if (!(w.field in item)) throw new ToolError(`where: items have no field "${w.field}" (fields: ${Object.keys(item).join(", ")})`);
  const v = item[w.field];
  switch (w.op) {
    case "eq": return looseEqual(v, w.value);
    case "ne": return !looseEqual(v, w.value);
    case "gt": return Number(v) > Number(w.value);
    case "gte": return Number(v) >= Number(w.value);
    case "lt": return Number(v) < Number(w.value);
    case "lte": return Number(v) <= Number(w.value);
    case "contains": return String(v).toLowerCase().includes(String(w.value).toLowerCase());
    case "in": return Array.isArray(w.value) && w.value.some((x) => looseEqual(v, x));
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * select: `from` (a reference, or a list of references that are joined together), then in this order:
 * compute (add fields from arithmetic), where (filter), sort, limit, pick (keep only some fields).
 */
export function runSelect(args: Record<string, any>, store: Store): unknown {
  if (args.from === undefined) throw new ToolError("select needs args.from");
  let rows: unknown;
  if (Array.isArray(args.from)) {
    rows = (resolveDeep(args.from, store) as unknown[]).flatMap((part) => (Array.isArray(part) ? part : [part]));
  } else rows = resolveDeep(args.from, store);

  const single = isObject(rows);
  let list: unknown[] = single ? [rows] : (rows as unknown[]);
  if (!Array.isArray(list)) throw new ToolError("select: args.from must be a list or an object");
  if (list.some((r) => !isObject(r))) throw new ToolError("select: every item must be an object (use the list of records, e.g. $page.books)");
  let items = list as Record<string, unknown>[];

  if (args.compute !== undefined) {
    if (!isObject(args.compute)) throw new ToolError("select: compute must be an object like {\"price_inr\": \"price_gbp * $fx.rate\"}");
    items = items.map((it) => {
      const extra: Record<string, unknown> = {};
      for (const [field, expr] of Object.entries(args.compute)) extra[field] = evalExpr(expr, store, it);
      return { ...it, ...extra };
    });
  }
  if (args.where !== undefined) {
    const conds = (Array.isArray(args.where) ? args.where : [args.where]).map((w: any) => {
      if (!isObject(w) || typeof w.field !== "string" || !(OPS as readonly unknown[]).includes(w.op)) throw new ToolError(`select: where needs {field, op (${OPS.join("|")}), value}`);
      return { field: w.field, op: w.op as SelectOp, value: resolveDeep(w.value, store) };
    });
    items = items.filter((it) => conds.every((c) => matches(it, c)));
  }
  if (args.sort !== undefined) {
    const by = isObject(args.sort) ? args.sort.by : args.sort;
    const dir = isObject(args.sort) && args.sort.order === "desc" ? -1 : 1;
    if (typeof by !== "string") throw new ToolError("select: sort needs a field name or {by, order}");
    if (items.some((it) => !(by in it))) throw new ToolError(`select: cannot sort by "${by}"; some items lack it`);
    items = [...items].sort((a, b) => {
      const x = a[by], y = b[by];
      return dir * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)));
    });
  }
  if (args.limit !== undefined) {
    const n = Number(resolveDeep(args.limit, store));
    if (!Number.isInteger(n) || n < 0) throw new ToolError("select: limit must be a whole number");
    items = items.slice(0, n);
  }
  if (args.pick !== undefined) {
    if (!Array.isArray(args.pick) || args.pick.some((f: unknown) => typeof f !== "string")) throw new ToolError("select: pick must be a list of field names");
    const keep = args.pick as string[];
    items = items.map((it) => Object.fromEntries(keep.filter((k) => k in it).map((k) => [k, it[k]])));
  }
  return single ? (items[0] ?? null) : items;
}

export function runTool(tool: ToolName, args: Record<string, any>, store: Store): unknown {
  if (tool === "select") return runSelect(args, store);
  if (tool === "calc") {
    if (args.expr === undefined) throw new ToolError("calc needs args.expr, e.g. \"100 * $fx.rate\"");
    return evalExpr(isRef(args.expr) ? resolveRef(args.expr, store) : args.expr, store);
  }
  throw new ToolError(`unknown tool "${tool}" (tools: ${TOOL_NAMES.join(", ")})`);
}
