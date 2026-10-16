// Exercises seller handlers and schemas directly (no payment) to check scraping, FX and schema validation.
import { scrapeCataloguePage } from "../../src/sellers/books.js";
import { getRate } from "../../src/sellers/fx.js";
import { sellerDefs } from "../../src/sellers/index.js";
import { validate } from "../../src/x402/schema.js";

const defs = Object.fromEntries(sellerDefs().map((d) => [d.id, d]));
const t = Date.now();
const books = await scrapeCataloguePage(1);
console.log(`scraped ${books.length} books in ${Date.now() - t} ms`, JSON.stringify(books[0]).slice(0, 240));
console.log("scrape output valid:", validate(defs["shelf-scraper"].outputSchema, { page: 1, source: "books.toscrape.com", books }));
console.log("fx:", await getRate("GBP", "INR"));
console.log("junk-fx output valid:", validate(defs["fx-rates"].outputSchema, await defs["junk-fx"].handler({ from: "GBP", to: "INR" })));
