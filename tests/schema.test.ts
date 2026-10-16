import { describe, expect, it } from "vitest";
import { validate, validateInput } from "../src/x402/schema.js";

const schema = { type: "object", required: ["rate", "from"], properties: { rate: { type: "number" }, from: { type: "string" } }, additionalProperties: false };

describe("output schema validation", () => {
  it("accepts conforming output", () => {
    expect(validate(schema, { rate: 105.2, from: "GBP" }).ok).toBe(true);
  });
  it("rejects wrong types without coercing", () => {
    expect(validate(schema, { rate: "105.2", from: "GBP" }).ok).toBe(false);
  });
  it("rejects missing fields and extra fields", () => {
    expect(validate(schema, { rate: 1 }).ok).toBe(false);
    expect(validate(schema, { rate: 1, from: "GBP", junk: true }).ok).toBe(false);
  });
  it("rejects non-objects (junk text, null, arrays)", () => {
    for (const bad of ["lol", null, [], 7]) expect(validate(schema, bad).ok).toBe(false);
  });
});

describe("input validation", () => {
  const pageSchema = { type: "object", properties: { page: { type: "integer", minimum: 1 } } };
  it("coerces query-string values to the declared types", () => {
    const data: any = { page: "2" };
    expect(validateInput(pageSchema, data).ok).toBe(true);
    expect(data.page).toBe(2);
  });
  it("rejects values outside the schema", () => {
    expect(validateInput(pageSchema, { page: "0" }).ok).toBe(false);
  });
});
