// Input/output schemas shared by a seller and by the sellers that hire it (travel-brief finds its suppliers by these schemas).

export const fxInput = {
  type: "object",
  properties: {
    from: { type: "string", pattern: "^[A-Za-z]{3}$" },
    to: { type: "string", pattern: "^[A-Za-z]{3}$" },
  },
  required: ["from", "to"],
  additionalProperties: false,
};

export const fxOutput = {
  type: "object",
  required: ["from", "to", "rate", "date"],
  properties: {
    from: { type: "string" },
    to: { type: "string" },
    rate: { type: "number", exclusiveMinimum: 0 },
    date: { type: "string" },
    source: { type: "string" },
  },
};

export const summariseInput = {
  type: "object",
  properties: {
    texts: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", minLength: 1, maxLength: 6000 } },
  },
  required: ["texts"],
  additionalProperties: false,
};

export const summariseOutput = {
  type: "object",
  required: ["language", "summaries"],
  properties: {
    language: { const: "hi" },
    model: { type: "string" },
    summaries: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1, pattern: "[\\u0900-\\u097F]" } } },
    },
  },
};
