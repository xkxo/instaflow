import "server-only";
import { prisma } from "./db";

// Stored in Postgres (not memory) so limits hold across serverless instances and restarts.
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export type RateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

/**
 * Best-effort client IP. Uses the RIGHTMOST X-Forwarded-For entry: Vercel overwrites the
 * header with the real client IP, and proxies like Railway's append it, so the rightmost
 * value is the one added by the platform rather than one a client could forge.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

async function check(ip: string, max: number): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.loginAttempt.findMany({
    where: { ip, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: max,
    select: { createdAt: true },
  });
  if (recent.length < max) return { limited: false };
  const unlockAt = recent[max - 1].createdAt.getTime() + WINDOW_MS;
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000)) };
}

/**
 * Reserves an attempt slot BEFORE the password is checked, so concurrent requests can't all
 * slip past the limit. Returns limited=true if this IP is out of attempts.
 */
export async function consumeLoginAttempt(ip: string): Promise<RateLimitResult> {
  // Already locked out: reject without writing, so hammering doesn't grow the table.
  const pre = await check(ip, MAX_ATTEMPTS);
  if (pre.limited) return pre;

  await prisma.loginAttempt.create({ data: { ip } });

  // Re-check including our own row; if concurrent requests pushed us over, reject.
  const post = await check(ip, MAX_ATTEMPTS + 1);
  if (post.limited) return post;

  // Opportunistic cleanup of expired rows (all IPs).
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - WINDOW_MS) } },
  });
  return { limited: false };
}

/** Successful login: forget this IP's failed attempts. */
export async function clearLoginAttempts(ip: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { ip } });
}
