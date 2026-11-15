import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listRecentEvents } from "@/lib/webhooks/store";

export const dynamic = "force-dynamic";

/** Recent webhook events for the Logs page. Session-protected by proxy.ts (and re-checked here). */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 200);
  return NextResponse.json(
    { events: await listRecentEvents(limit), fetchedAt: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
