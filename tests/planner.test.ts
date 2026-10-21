import { describe, expect, it } from "vitest";
import { parseRules } from "../src/buyer/planner.js";

describe("parseRules (numbers judges change live never depend on the LLM)", () => {
  it("parses the example task from the problem statement", () => {
    const r = parseRules("From pages 1-4 of books.toscrape.com, find the three cheapest 5-star books, give prices in rupees, summarise each description in Hindi.");
    expect(r).toMatchObject({ pages: { from: 1, to: 4 }, limit: 3, sort: "asc", rating: { op: "eq", value: 5 }, currency: "INR", summarise: true });
  });

  it("follows changed numbers, words and currency", () => {
    const r = parseRules("Look at pages 2 to 3 and pick the five most expensive 4-star books in euros");
    expect(r).toMatchObject({ pages: { from: 2, to: 3 }, limit: 5, sort: "desc", rating: { op: "eq", value: 4 }, currency: "EUR" });
    expect(r.summarise).toBe(false);
  });

  it("understands at-least ratings and first-N-pages", () => {
    const r = parseRules("In the first two pages find the 2 cheapest books with at least 3 stars in US dollars");
    expect(r).toMatchObject({ pages: { from: 1, to: 2 }, limit: 2, rating: { op: "gte", value: 3 }, currency: "USD" });
  });

  it("handles a single page and no rating filter", () => {
    const r = parseRules("on page 7 find the cheapest 3 books");
    expect(r.pages).toEqual({ from: 7, to: 7 });
    expect(r.rating).toBeNull();
  });

  it("returns only what it can find", () => {
    const r = parseRules("hello");
    expect(r.pages).toBeUndefined();
    expect(r.limit).toBeUndefined();
    expect(r.currency).toBeUndefined();
  });
});

describe("beyondBooks (what the AI-off fallback must refuse)", () => {
  it("flags weather and sentiment parts but not plain book tasks", async () => {
    const { beyondBooks } = await import("../src/buyer/scout.js");
    expect(beyondBooks("Check the weather in Tokyo, then the two cheapest books")).toBe("weather");
    expect(beyondBooks("three cheapest books, and say whether each description sounds positive or negative")).toBe("positive");
    expect(beyondBooks("From pages 1 to 4 of books.toscrape.com, find the three cheapest 5-star books, give their prices in rupees, and summarise each description in Hindi.")).toBeUndefined();
  });
});

describe("stored runs stay bounded", () => {
  it("past MAX_RUNS the oldest finished runs go, running ones stay", async () => {
    const { rememberRun, getRun, MAX_RUNS } = await import("../src/buyer/scout.js");
    const run = (id: string, state: "running" | "done") => ({ id, state, task: "", budget: "0", maxConcurrency: 1, mode: "agent", dryRun: true, log: [], purchases: [], startedAt: "" }) as any;
    rememberRun(run("keep-running", "running"));
    for (let i = 0; i < MAX_RUNS + 10; i++) rememberRun(run(`r${i}`, "done"));
    expect(getRun("keep-running")).toBeDefined();
    expect(getRun("r0")).toBeUndefined();
    expect(getRun(`r${MAX_RUNS + 9}`)).toBeDefined();
  });
});
