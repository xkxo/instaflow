import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { drainJobs, jobQueueStats } from "@/lib/flow/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs due flow jobs (retries after backoff, delayed sends). Needed on serverless hosts, where
 * there's no long-running poller: call it every minute (Vercel Pro cron, or an external pinger).
 * Auth: CRON_SECRET as "Authorization: Bearer <secret>" or "x-cron-secret". Sessionless (proxy.ts).
 */
async function handler(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const auth = request.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : request.headers.get("x-cron-secret")?.trim();
  if (!provided || !safeEqual(provided, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { processed } = await drainJobs({ maxMs: 50_000 });
  return NextResponse.json({ processed, queue: await jobQueueStats() });
}

export { handler as GET, handler as POST };
