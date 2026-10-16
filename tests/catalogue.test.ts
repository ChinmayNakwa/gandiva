import { describe, expect, it } from "vitest";
import { describeSchema, estimatePrice, findGroup, groupServices, renderCatalogue, sampleFromSchema } from "../src/buyer/catalogue.js";
import { sellerDefs } from "../src/sellers/index.js";
import { service } from "./helpers.js";

const rep = (score: number) => ({ attempts: 1, successes: 1, successRate: 1, medianLatencyMs: null, score, isNew: false });
const fromDefs = () =>
  sellerDefs().map((d) => ({
    ...service({ id: d.id, name: d.name, category: d.category, price: d.listedPrice.toString(), inputSchema: d.inputSchema, outputSchema: d.outputSchema, description: d.description }),
    reputation: rep(1),
  }));

describe("catalogue grouping", () => {
  const all = fromDefs();
  const groups = groupServices(all);

  it("puts sellers with identical category and schemas into one group", () => {
    const scrapers = groups.find((g) => g.category === "scraping")!;
    expect([...scrapers.memberIds].sort()).toEqual(["cheap-scraper", "mirror-scraper", "shelf-scraper"]);
    const fx = groups.find((g) => g.memberIds.includes("fx-rates"))!;
    expect([...fx.memberIds].sort()).toEqual(["fx-rates", "junk-fx"]);
    expect(fx.minPrice).toBe(800n);
    expect(fx.maxPrice).toBe(1000n);
  });

  it("keeps different jobs in the same category apart", () => {
    const data = groups.filter((g) => g.category === "data").map((g) => [...g.memberIds].sort().join("+"));
    expect(data.sort()).toEqual(["city-info", "fx-rates+junk-fx"]);
    const inference = groups.filter((g) => g.category === "inference").map((g) => g.memberIds[0]);
    expect(inference.sort()).toEqual(["hindi-summary", "sentiment", "travel-brief"]);
  });

  it("uses the best-ranked member as the group's handle and finds groups by any member name", () => {
    expect(groups.find((g) => g.category === "scraping")!.handle).toBe(all.find((s) => s.category === "scraping")!.name);
    expect(findGroup(groups, "JUNK-FX", all)?.memberIds).toContain("fx-rates");
    expect(findGroup(groups, "shelf-scraper", all)?.category).toBe("scraping");
    expect(findGroup(groups, "no-such-seller", all)).toBeUndefined();
  });

  it("renders a compact catalogue that shows batching limits", () => {
    const text = renderCatalogue(groups);
    expect(text).toContain("interchangeable sellers: 3");
    expect(text).toContain("input: {texts: [string (max 6000 chars)] (1-2 items)}");
    expect(text).toContain("0.000800-0.001000 USDC");
    expect(text).toContain("input: {page: int 1..1000}");
  });
});

describe("estimatePrice", () => {
  const m = (price: string, score: number) => ({ ...service({ price }), reputation: rep(score) });
  it("plans with the dearest seller that has not proved unreliable", () => {
    expect(estimatePrice([m("2000", 1), m("5000", 1)])).toBe(5000n);
    expect(estimatePrice([m("2000", 1), m("5000", 0.2)])).toBe(2000n);
    expect(estimatePrice([m("2000", 0.1), m("5000", 0.2)])).toBe(5000n);
    expect(estimatePrice([])).toBe(0n);
  });
});

describe("describeSchema / sampleFromSchema", () => {
  it("describes enums, consts, nullable and optional fields", () => {
    expect(describeSchema({ type: "object", required: ["a"], properties: { a: { enum: ["x", "y"] }, b: { type: ["integer", "null"] }, c: { const: "hi" } } })).toBe('{a: "x"|"y", b?: int or null, c?: "hi"}');
  });
  it("builds sample data for dry runs", () => {
    const city: any = sampleFromSchema(sellerDefs().find((x) => x.id === "city-info")!.outputSchema);
    expect(city.currency).toBe("USD");
    expect(typeof city.temperature_c).toBe("number");
    const scrape: any = sampleFromSchema(sellerDefs().find((x) => x.id === "shelf-scraper")!.outputSchema);
    expect(scrape.books).toHaveLength(3);
    expect(scrape.books.map((b: any) => b.rating)).toEqual([5, 4, 3]);
    expect(scrape.books.map((b: any) => b.price_gbp)).toEqual([1, 2, 3]);
  });
});
