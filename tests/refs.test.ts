import { describe, expect, it } from "vitest";
import { isRef, referencedNames, RefError, resolveDeep, resolveRef, type Store } from "../src/buyer/refs.js";
import { evalExpr, runSelect, runTool, ToolError } from "../src/buyer/tools.js";

const books = [
  { title: "A", price_gbp: 20, rating: 5, description: "da" },
  { title: "B", price_gbp: 10, rating: 5, description: "db" },
  { title: "C", price_gbp: 15, rating: 3, description: "dc" },
  { title: "D", price_gbp: 5, rating: 5, description: "dd" },
];
const store = (): Store =>
  new Map<string, unknown>([
    ["p1", { page: 1, books }],
    ["fx", { rate: 100, date: "2026-01-01" }],
    ["n", 7],
  ]);

describe("reference resolver", () => {
  it("recognises whole-string references only", () => {
    expect(isRef("$p1")).toBe(true);
    expect(isRef("$p1.books[0:2].title")).toBe(true);
    expect(isRef("$5 only")).toBe(false);
    expect(isRef("cost is $p1")).toBe(false);
  });

  it("resolves fields, indexes, slices and projections", () => {
    const s = store();
    expect(resolveRef("$fx.rate", s)).toBe(100);
    expect(resolveRef("$p1.books[1].title", s)).toBe("B");
    expect(resolveRef("$p1.books[-1].title", s)).toBe("D");
    expect(resolveRef("$p1.books[0:2].description", s)).toEqual(["da", "db"]);
    expect(resolveRef("$p1.books[2:].title", s)).toEqual(["C", "D"]);
    expect(resolveRef("$p1.books[:1]", s)).toEqual([books[0]]);
    expect(resolveRef("$p1.books[*].rating", s)).toEqual([5, 5, 3, 5]);
    expect(resolveRef("$n", s)).toBe(7);
  });

  it("gives errors the model can act on", () => {
    const s = store();
    expect(() => resolveRef("$nope.x", s)).toThrow(/no result named "nope".*available: p1, fx, n/);
    expect(() => resolveRef("$fx.rte", s)).toThrow(/no field "rte" \(available: rate, date\)/);
    expect(() => resolveRef("$p1.books[9]", s)).toThrow(/out of range \(the list has 4 items\)/);
    expect(() => resolveRef("$fx[0]", s)).toThrow(RefError);
    expect(() => resolveRef("$p1.books.nothing", s)).toThrow(/item 0 has no field "nothing"/);
  });

  it("resolves references nested in inputs and leaves other strings alone", () => {
    const out = resolveDeep({ texts: "$p1.books[0:2].description", from: "GBP", note: "price is $5", nested: [{ r: "$fx.rate" }] }, store());
    expect(out).toEqual({ texts: ["da", "db"], from: "GBP", note: "price is $5", nested: [{ r: 100 }] });
  });

  it("lists the names an expression or value mentions", () => {
    expect([...referencedNames({ a: "$p1.books", b: ["x", "price * $fx.rate"] })].sort()).toEqual(["fx", "p1"]);
  });
});

describe("calc", () => {
  const s = store();
  it("does arithmetic with references, precedence and round()", () => {
    expect(evalExpr("100 * $fx.rate", s)).toBe(10000);
    expect(evalExpr("2 + 3 * 4", s)).toBe(14);
    expect(evalExpr("(2 + 3) * 4 - -1", s)).toBe(21);
    expect(evalExpr("round(10 / 3, 2)", s)).toBe(3.33);
    expect(evalExpr("round(2.5)", s)).toBe(2.5);
  });
  it("rejects bad input instead of guessing", () => {
    expect(() => evalExpr("1 / 0", s)).toThrow(ToolError);
    expect(() => evalExpr("2 +", s)).toThrow(ToolError);
    expect(() => evalExpr("alert(1)", s)).toThrow(/unknown name/);
    expect(() => evalExpr("$p1", s)).toThrow(/not a number/);
    expect(() => evalExpr("1 # 2", s)).toThrow(ToolError);
  });
  it("is reachable as a tool", () => {
    expect(runTool("calc", { expr: "$n * 2" }, s)).toBe(14);
  });
});

describe("select", () => {
  it("filters, sorts, limits and computes", () => {
    const s = store();
    const out = runSelect({ from: "$p1.books", where: [{ field: "rating", op: "eq", value: 5 }], sort: { by: "price_gbp" }, limit: 2, compute: { price_inr: "price_gbp * $fx.rate" } }, s) as any[];
    expect(out.map((b) => b.title)).toEqual(["D", "B"]);
    expect(out.map((b) => b.price_inr)).toEqual([500, 1000]);
  });
  it("joins several lists and supports descending sort and pick", () => {
    const s = store();
    s.set("p2", { books: [{ title: "E", price_gbp: 50, rating: 1, description: "de" }] });
    const out = runSelect({ from: ["$p1.books", "$p2.books"], sort: { by: "price_gbp", order: "desc" }, limit: 1, pick: ["title"] }, s);
    expect(out).toEqual([{ title: "E" }]);
  });
  it("can filter on a computed field and use a reference as the value", () => {
    const s = store();
    expect(runSelect({ from: "$p1.books", compute: { inr: "price_gbp * $fx.rate" }, where: { field: "inr", op: "lt", value: "$n" } }, s)).toEqual([]);
    expect(runSelect({ from: "$p1.books", where: [{ field: "title", op: "in", value: ["a", "C"] }] }, s)).toHaveLength(2);
  });
  it("adds computed fields to a single object", () => {
    expect(runSelect({ from: "$fx", compute: { doubled: "rate * 2" } }, store())).toMatchObject({ rate: 100, doubled: 200 });
  });
  it("explains what is wrong", () => {
    const s = store();
    expect(() => runSelect({}, s)).toThrow(/needs args.from/);
    expect(() => runSelect({ from: "$p1.books", where: [{ field: "nope", op: "eq", value: 1 }] }, s)).toThrow(/no field "nope"/);
    expect(() => runSelect({ from: "$p1.books", where: [{ field: "title", op: "bad", value: 1 }] }, s)).toThrow(/where needs/);
    expect(() => runSelect({ from: "$p1.books", limit: 1.5 }, s)).toThrow(/whole number/);
    expect(() => runSelect({ from: "$p1.books", sort: { by: "zzz" } }, s)).toThrow(/cannot sort/);
  });
});
