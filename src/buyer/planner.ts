import { z } from "zod";
import { chat } from "../llm.js";

export const taskPlan = z.object({
  pages: z.object({ from: z.number().int().min(1).max(50), to: z.number().int().min(1).max(50) }),
  rating: z.object({ op: z.enum(["eq", "gte", "lte"]), value: z.number().int().min(1).max(5) }).nullable(),
  sort: z.enum(["asc", "desc"]),
  limit: z.number().int().min(1).max(20),
  currency: z.string().regex(/^[A-Z]{3}$/),
  summarise: z.boolean(),
});
export type TaskPlan = z.infer<typeof taskPlan>;

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, single: 1 };
const num = (s: string | undefined) => (s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";

const CURRENCIES: [RegExp, string][] = [
  [/\b(rupees?|inr|₹)/i, "INR"],
  [/\b(euros?|eur|€)/i, "EUR"],
  [/\b(yen|jpy|¥)/i, "JPY"],
  [/\b(us ?dollars?|usd|\$)/i, "USD"],
  [/\b(pounds?|gbp|sterling|£)/i, "GBP"],
  [/\b(dirhams?|aed)/i, "AED"],
  [/\b(yuan|cny|rmb)/i, "CNY"],
];

/** Deterministic parse of the numbers that matter. Judges change numbers on the spot, so these never depend on the LLM. */
export function parseRules(task: string): Partial<TaskPlan> {
  const t = task.replace(/[–—]/g, "-");
  const out: Partial<TaskPlan> = {};

  const range = t.match(new RegExp(`pages?\\s+${NUM}\\s*(?:-|to|through|and|until)\\s*${NUM}`, "i"));
  const single = t.match(new RegExp(`page\\s+${NUM}\\b`, "i"));
  const firstN = t.match(new RegExp(`first\\s+${NUM}\\s+pages`, "i"));
  if (range) out.pages = { from: num(range[1])!, to: num(range[2])! };
  else if (firstN) out.pages = { from: 1, to: num(firstN[1])! };
  else if (single) out.pages = { from: num(single[1])!, to: num(single[1])! };

  const desc = /(most expensive|priciest|highest[- ]priced|dearest)/i.test(t);
  out.sort = desc ? "desc" : "asc";
  const lim =
    t.match(new RegExp(`${NUM}\\s+(?:cheapest|most expensive|priciest|lowest[- ]priced|highest[- ]priced)`, "i")) ??
    t.match(new RegExp(`(?:cheapest|most expensive|priciest)\\s+${NUM}\\b`, "i")) ??
    t.match(new RegExp(`(?:top|find|pick)\\s+${NUM}\\b`, "i"));
  if (lim) out.limit = num(lim[1]);

  const star = t.match(new RegExp(`(at least|minimum|min\\.?|at most|maximum|max\\.?)?\\s*${NUM}[- ]?stars?`, "i"));
  if (star) {
    const q = (star[1] ?? "").toLowerCase();
    out.rating = { op: /least|min/.test(q) ? "gte" : /most|max/.test(q) ? "lte" : "eq", value: num(star[2])! };
  } else out.rating = null;

  for (const [re, code] of CURRENCIES) {
    if (re.test(t)) {
      out.currency = code;
      break;
    }
  }
  out.summarise = /hindi|summar/i.test(t);
  return out;
}

async function parseWithLlm(task: string): Promise<Partial<TaskPlan>> {
  const raw = await chat(
    [
      {
        role: "system",
        content:
          "Extract a JSON plan for a book research task over books.toscrape.com. Reply with JSON only, matching: " +
          '{"pages":{"from":int,"to":int},"rating":{"op":"eq"|"gte"|"lte","value":1-5}|null,"sort":"asc"|"desc","limit":int,"currency":"ISO 4217 code","summarise":bool}. ' +
          "sort=asc means cheapest first. summarise=true when the user wants Hindi summaries.",
      },
      { role: "user", content: task },
    ],
    { json: true, timeoutMs: 30_000, temperature: 0 },
  );
  return JSON.parse(raw);
}

export async function planTask(task: string): Promise<{ plan: TaskPlan; planner: string; notes: string[] }> {
  const rules = parseRules(task);
  const notes: string[] = [];
  let planner = "rules";
  let llm: Partial<TaskPlan> = {};
  const missing = (["pages", "limit", "currency"] as const).filter((k) => rules[k] === undefined);
  if (missing.length) {
    try {
      llm = await parseWithLlm(task);
      planner = "rules + llm";
      notes.push(`LLM filled: ${missing.join(", ")}`);
    } catch (err: any) {
      notes.push(`LLM planner unavailable (${err?.message ?? err}); using defaults for: ${missing.join(", ")}`);
    }
  }
  const merged = {
    pages: rules.pages ?? llm.pages ?? { from: 1, to: 1 },
    rating: rules.rating !== undefined && rules.rating !== null ? rules.rating : (llm.rating ?? null),
    sort: rules.sort ?? llm.sort ?? "asc",
    limit: rules.limit ?? llm.limit ?? 3,
    currency: (rules.currency ?? llm.currency ?? "INR").toUpperCase(),
    summarise: rules.summarise ?? llm.summarise ?? true,
  };
  if (merged.pages.from > merged.pages.to) merged.pages = { from: merged.pages.to, to: merged.pages.from };
  return { plan: taskPlan.parse(merged), planner, notes };
}
