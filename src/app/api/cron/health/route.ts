import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { pruneJobs } from "@/lib/flow/jobs";
import { checkTokenHealth } from "@/lib/instagram-account";

export const dynamic = "force-dynamic";

/**
 * Daily token health check. Calls /debug_token; if the token has become invalid
 * (e.g. the app was removed from the business portfolio), it's marked INVALID and
 * the app shows a red banner until you reconnect.
 *
 * Auth: send CRON_SECRET as either
 *   Authorization: Bearer <CRON_SECRET>   (Vercel Cron does this automatically)
 *   x-cron-secret: <CRON_SECRET>          (for other schedulers)
 * Exempt from the session check in proxy.ts.
 *
 * Status codes: 200 valid / no_account · 502 invalid (so scheduler alerts fire) · 503 couldn't verify.
 */
async function handler(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing to run");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : request.headers.get("x-cron-secret")?.trim();
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkTokenHealth();
  console.info(`[cron] health: ${result.status}`);
  const pruned = await pruneJobs().catch(() => 0);
  if (pruned) console.info(`[cron] pruned ${pruned} finished job(s)`);
  const status = result.status === "invalid" ? 502 : result.status === "unknown" ? 503 : 200;
  return NextResponse.json(result, { status });
}

export { handler as GET, handler as POST };
