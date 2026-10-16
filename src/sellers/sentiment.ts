import { config } from "../config.js";
import { chat } from "../llm.js";
import { ServiceError } from "../x402/paidRoute.js";

export const sentimentInput = {
  type: "object",
  properties: {
    texts: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 4000 } },
  },
  required: ["texts"],
  additionalProperties: false,
};

export const sentimentOutput = {
  type: "object",
  required: ["model", "results"],
  properties: {
    model: { type: "string" },
    results: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        required: ["label", "score", "reason"],
        properties: {
          label: { enum: ["positive", "neutral", "negative"] },
          score: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

const LABELS = ["positive", "neutral", "negative"];

/** Turns the model's reply into strict results, or throws so the buyer is not charged for a malformed answer. */
export function parseSentiment(raw: string, expected: number) {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServiceError("model did not return JSON", 502);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(list) || list.length !== expected) throw new ServiceError(`model returned ${Array.isArray(list) ? list.length : "no"} results for ${expected} text(s)`, 502);
  return list.map((r: any, i: number) => {
    const label = String(r?.label ?? "").toLowerCase();
    const score = Number(r?.score);
    const reason = typeof r?.reason === "string" ? r.reason.trim() : "";
    if (!LABELS.includes(label)) throw new ServiceError(`result ${i + 1} has invalid label "${r?.label}"`, 502);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new ServiceError(`result ${i + 1} has invalid score`, 502);
    if (!reason) throw new ServiceError(`result ${i + 1} has no reason`, 502);
    return { label, score, reason };
  });
}

/** Sentiment of 1-4 short texts with an LLM; label, confidence score and a one-line reason for each. */
export async function analyseSentiment(input: { texts: string[] }) {
  const numbered = input.texts.map((t, i) => `${i + 1}. ${t}`).join("\n\n");
  const raw = await chat(
    [
      {
        role: "system",
        content:
          "You classify the sentiment of texts. Reply with JSON only: " +
          '{"results":[{"label":"positive"|"neutral"|"negative","score":number between 0 and 1 (confidence),"reason":"one short sentence"}]}. ' +
          "Return exactly one result per text, in the same order.",
      },
      { role: "user", content: numbered },
    ],
    { json: true, timeoutMs: 40_000, temperature: 0 },
  ).catch((err) => {
    throw new ServiceError(`model unavailable: ${err?.message ?? err}`, 502);
  });
  return { model: config.ollama.model, results: parseSentiment(raw, input.texts.length) };
}
