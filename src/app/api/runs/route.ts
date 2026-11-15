import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listRecentRuns } from "@/lib/flow/queries";

export const dynamic = "force-dynamic";

/** Recent flow runs with timelines, for the Logs page. Session-protected. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 30, 1), 100);
  return NextResponse.json({ runs: await listRecentRuns(limit) }, { headers: { "cache-control": "no-store" } });
}
