import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretsConfigured, SecretsError } from "../src/crypto/secrets.js";

const KEY = "ab".repeat(32);
const OTHER_KEY = "cd".repeat(32);

describe("secrets: AES-256-GCM at rest", () => {
  it("round-trips and never stores the plain text", () => {
    const token = encryptSecret("sk-my-ollama-key", KEY);
    expect(token).not.toContain("sk-my-ollama-key");
    expect(decryptSecret(token, KEY)).toBe("sk-my-ollama-key");
  });

  it("uses a fresh IV, so the same secret encrypts differently each time", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("refuses the wrong key and damaged data", () => {
    const token = encryptSecret("secret", KEY);
    expect(() => decryptSecret(token, OTHER_KEY)).toThrow(SecretsError);
    const [v, iv, tag, ct] = token.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"), KEY)).toThrow(SecretsError);
    expect(() => decryptSecret("not-a-token", KEY)).toThrow(SecretsError);
  });

  it("will not encrypt without a proper 64-hex key", () => {
    expect(secretsConfigured("")).toBe(false);
    expect(secretsConfigured("abc")).toBe(false);
    expect(secretsConfigured(KEY)).toBe(true);
    expect(() => encryptSecret("x", "")).toThrow(SecretsError);
    expect(() => encryptSecret("x", "short")).toThrow(SecretsError);
  });
});
