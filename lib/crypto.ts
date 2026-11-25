/**
 * Encrypts users' own API keys before they reach the database (AES-256-GCM).
 * The key lives only in the OWN_KEYS_ENCRYPTION_KEY environment variable, so a
 * leaked database row is useless on its own. Each value is bound to its owner
 * (the user id is the additional authenticated data), so a row copied to
 * another user fails to decrypt. Server only.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

const FORMAT = "v1";
const IV_BYTES = 12;

function encryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("OWN_KEYS_ENCRYPTION_KEY must be 32 random bytes, base64 encoded");
  return key;
}

/** "v1:<iv>:<tag>:<ciphertext>", all base64. */
export function encryptSecret(plain: string, owner: string, rawKey: string = serverEnv.ownKeysEncryptionKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(rawKey), iv);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [FORMAT, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** Throws when the value was tampered with, belongs to another owner, or was made with another key. */
export function decryptSecret(payload: string, owner: string, rawKey: string = serverEnv.ownKeysEncryptionKey): string {
  const [format, iv, tag, data] = payload.split(":");
  if (format !== FORMAT || !iv || !tag || data === undefined) throw new Error("Unreadable saved key");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(rawKey), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(owner, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** The last four characters, for "saved key ending in ...". Never enough to use. */
export function secretHint(secret: string): string {
  const value = secret.trim();
  return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}
