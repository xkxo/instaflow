// Session token signing/verification. Runtime-agnostic (used by proxy.ts and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "instaflow_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const ISSUER = "instaflow";
const AUDIENCE = "instaflow:owner";

let cachedKey: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  // Resolve the key outside try/catch so a misconfigured secret fails loudly
  // instead of silently looking like "logged out".
  const key = getKey();
  try {
    await jwtVerify(token, key, { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
    return true;
  } catch {
    return false;
  }
}
