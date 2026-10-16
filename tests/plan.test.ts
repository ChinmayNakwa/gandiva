import { describe, expect, it } from "vitest";
import { groupServices } from "../src/buyer/catalogue.js";
import { parseRound, validateRound, type ValidationEnv } from "../src/buyer/plan.js";
import { sellerDefs } from "../src/sellers/index.js";
import { service } from "./helpers.js";

const all = sellerDefs().map((d) => ({
  ...service({ id: d.id, name: d.name, category: d.category, price: d.listedPrice.toString(), inputSchema: d.inputSchema, outputSchema: d.outputSchema }),
  reputation: { attempts: 0, successes: 0, successRate: 0, medianLatencyMs: null, score: 1 },
}));
const env = (store: Record<string, unknown> = {}, callsLeft = 40): ValidationEnv => ({ groups: groupServices(all), all, store: new Map(Object.entries(store)), callsLeft });
const parse = (obj: unknown) => {
  const r = parseRound(JSON.stringify(obj));
  if (!r.ok) throw new Error(r.error);
  return r.round;
};

describe("parseRound", () => {
  it("accepts fenced JSON, nulls and a leading $ in names", () => {
    const r = parseRound('```json\n{"calls":[{"service":"fx-rates","input":{"from":"GBP","to":"INR"},"as":"$fx"}],"tools":null,"final":null}\n```');
    expect(r.ok && r.round.calls[0].as).toBe("fx");
    expect(r.ok && r.round.tools).toEqual([]);
  });
  it("finds JSON wrapped in chatter", () => {
    expect(parseRound('Sure! {"final":{"answer":"done"}} hope that helps').ok).toBe(true);
  });
  it("reports unusable replies", () => {
    expect(parseRound("I will now buy things").ok).toBe(false);
    const bad = parseRound('{"calls":[{"input":{}}]}');
    expect(!bad.ok && bad.error).toMatch(/calls\.0\.service/);
    expect(parseRound('{"tools":[{"tool":"hack","as":"x"}]}').ok).toBe(false);
    expect(parseRound('{"calls":[{"service":"x","as":"bad name"}]}').ok).toBe(false);
  });
});

describe("validateRound", () => {
  it("resolves references and coerces inputs before anything is paid", () => {
    const v = validateRound(
      parse({ calls: [{ service: "hindi-summary", input: { texts: "$p1.books[0:2].description" }, as: "s1" }, { service: "shelf-scraper", input: { page: "3" } }] }),
      env({ p1: { books: [{ description: "a" }, { description: "b" }, { description: "c" }] } }),
    );
    expect(v.issues).toEqual([]);
    expect(v.calls[0].input).toEqual({ texts: ["a", "b"] });
    expect(v.calls[1].input).toEqual({ page: 3 });
    expect(v.calls[1].as).toBe("c1");
  });

  it("accepts a member name for its group", () => {
    const v = validateRound(parse({ calls: [{ service: "junk-fx", input: { from: "GBP", to: "INR" }, as: "fx" }] }), env());
    expect(v.issues).toEqual([]);
    expect(v.calls[0].group.memberIds).toContain("fx-rates");
  });

  it("lists every problem in one go", () => {
    const v = validateRound(
      parse({
        calls: [
          { service: "teleport", input: {}, as: "a" },
          { service: "hindi-summary", input: { texts: ["x", "y", "z"] }, as: "b" },
          { service: "fx-rates", input: { from: "GBP", to: "$ghost.currency" }, as: "p1" },
        ],
      }),
      env({ p1: 1 }),
    );
    const text = v.issues.join("\n");
    expect(v.issues).toHaveLength(4);
    expect(text).toMatch(/unknown service "teleport"; use one of:/);
    expect(text).toMatch(/more than 2 items/);
    expect(text).toMatch(/no result named "ghost"/);
    expect(text).toMatch(/name "p1" is already used/);
  });

  it("rejects the same name twice in one turn and too many calls", () => {
    const calls = [
      { service: "shelf-scraper", input: { page: 1 }, as: "x" },
      { service: "shelf-scraper", input: { page: 2 }, as: "x" },
    ];
    expect(validateRound(parse({ calls }), env()).issues.join()).toMatch(/already used/);
    expect(validateRound(parse({ calls }), env({}, 1)).issues.join()).toMatch(/too many paid calls/);
  });

  it("lets tools use this turn's call results but not names that never exist", () => {
    const ok = validateRound(
      parse({ calls: [{ service: "shelf-scraper", input: { page: 1 }, as: "p1" }], tools: [{ tool: "select", as: "t", args: { from: "$p1.books" } }, { tool: "calc", as: "u", args: { expr: "$t" } }] }),
      env(),
    );
    expect(ok.issues).toEqual([]);
    const bad = validateRound(parse({ tools: [{ tool: "calc", as: "u", args: { expr: "$zzz * 2" } }] }), env());
    expect(bad.issues.join()).toMatch(/\$zzz, which do not exist/);
  });

  it("checks final outputs and ignores a final that arrives with new calls", () => {
    const e = env({ top: [1, 2] });
    expect(validateRound(parse({ final: { answer: "done", outputs: { books: "$top" } } }), e).final).toEqual({ answer: "done", outputs: { books: [1, 2] } });
    expect(validateRound(parse({ final: { answer: "done", outputs: { books: "$gone" } } }), e).issues.join()).toMatch(/final.outputs/);
    const mixed = validateRound(parse({ calls: [{ service: "shelf-scraper", input: { page: 1 } }], final: { answer: "guess" } }), e);
    expect(mixed.finalIgnored).toBe(true);
    expect(mixed.final).toBeUndefined();
  });

  it("lets calls wait for results created in the same turn, and rejects circles", () => {
    const chain = validateRound(
      parse({
        calls: [
          { service: "shelf-scraper", input: { page: 1 }, as: "p1" },
          { service: "hindi-summary", input: { texts: "$top[0:2].description" }, as: "s1" },
        ],
        tools: [{ tool: "select", as: "top", args: { from: "$p1.books", limit: 2 } }],
      }),
      env(),
    );
    expect(chain.issues).toEqual([]);
    expect(chain.calls.map((c) => [c.as, c.deps, c.input === undefined])).toEqual([["p1", [], false], ["s1", ["top"], true]]);
    expect(chain.tools[0].deps).toEqual(["p1"]);

    const circle = validateRound(
      parse({ calls: [{ service: "hindi-summary", input: { texts: "$a" }, as: "x" }], tools: [{ tool: "select", as: "a", args: { from: "$x.summaries" } }] }),
      env(),
    );
    expect(circle.issues.join()).toMatch(/circular dependency between: x, a/);
  });

  it("refuses a final answer before anything was tried (no giving up in advance on a small budget)", () => {
    const final = parse({ final: { answer: "I cannot afford this." } });
    expect(validateRound(final, { ...env(), started: false }).issues.join()).toMatch(/nothing has been tried yet/);
    expect(validateRound(final, { ...env(), started: true }).issues).toEqual([]);
  });

  it("needs something to do", () => {
    expect(validateRound(parse({}), env()).issues.join()).toMatch(/no "calls", no "tools" and no "final"/);
  });
});
