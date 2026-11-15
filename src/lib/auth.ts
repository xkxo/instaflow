import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "./session";

export async function setSessionCookie(): Promise<void> {
  const token = await createSessionToken();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Browsers drop Secure cookies over plain http (except localhost in some browsers),
    // so only require it in production where the app is served over HTTPS.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isAuthenticated(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Defense-in-depth check for server components / actions (proxy.ts is the first line). */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) redirect("/login");
}

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** Returns the configured bcrypt hash, or null (and logs why) if it's missing/mangled. */
export function getPasswordHash(): string | null {
  const hash = process.env.APP_PASSWORD_HASH?.trim();
  if (!hash || !BCRYPT_HASH_RE.test(hash)) {
    console.error(
      "[auth] APP_PASSWORD_HASH is missing or not a valid bcrypt hash. " +
        "Run `npm run hash-password`. In .env files, escape every $ as \$ " +
        "or Next.js will treat parts of the hash as variables.",
    );
    return null;
  }
  return hash;
}
