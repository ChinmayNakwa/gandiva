// Checks the configured Ollama endpoint, model and key by asking for a one-line Hindi summary.
import { config } from "../../src/config.js";
import { chat } from "../../src/llm.js";

console.log(`host ${config.ollama.host}, model ${config.ollama.model}, key ${config.ollama.apiKey ? "set" : "missing"}`);
const t = Date.now();
const out = await chat(
  [
    { role: "system", content: "Reply only in Hindi written in Devanagari script." },
    { role: "user", content: "Summarise in one sentence: A young wizard discovers a hidden school of magic and makes lifelong friends." },
  ],
  { timeoutMs: 60_000 },
);
console.log(`${Date.now() - t} ms, Devanagari: ${/[\u0900-\u097F]/.test(out)}\n${out}`);
