import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

/** Secrets (sellers' API keys, later the agent wallets' private keys) are stored AES-256-GCM encrypted with SECRETS_KEY. */
export class SecretsError extends Error {}

const KEY_HEX = /^[0-9a-fA-F]{64}$/;

export const secretsConfigured = (keyHex = config.secretsKey) => KEY_HEX.test(keyHex);

function keyBytes(keyHex: string): Buffer {
  if (!KEY_HEX.test(keyHex)) throw new SecretsError("SECRETS_KEY is not set (64 hex characters); the server cannot store secrets");
  return Buffer.from(keyHex, "hex");
}

/** "v1:<iv>:<tag>:<ciphertext>" (base64 parts). A fresh random IV per secret. */
export function encryptSecret(plain: string, keyHex = config.secretsKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(token: string, keyHex = config.secretsKey): string {
  const [version, iv, tag, ct] = token.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new SecretsError("stored secret has an unknown format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyHex), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof SecretsError) throw err;
    throw new SecretsError("stored secret cannot be decrypted (wrong SECRETS_KEY or damaged data)");
  }
}
