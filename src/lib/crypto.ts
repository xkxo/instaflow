import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (e.g. Instagram access tokens).
 *
 * Format: "v1.<iv>.<authTag>.<ciphertext>" (each part base64url).
 * The `context` string is bound as additional authenticated data, so a ciphertext
 * encrypted for one purpose can't be swapped in for another.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Use 32 random bytes as base64 (openssl rand -base64 32) or 64 hex chars.",
    );
  }
  cachedKey = key;
  return key;
}

export function encrypt(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(payload: string, context: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Encrypted value has an unrecognised format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Failed to decrypt value: wrong TOKEN_ENCRYPTION_KEY or tampered data.");
  }
}

/** Constant-time string comparison (hashes first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
