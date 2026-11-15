import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { describeError, getRecentMedia } from "@/lib/instagram";
import { getAccessToken } from "@/lib/instagram-account";

export const dynamic = "force-dynamic";

/** Recent posts/reels for the automation media picker. Session-protected. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "Connect your Instagram account in Settings first." }, { status: 409 });

  try {
    const after = request.nextUrl.searchParams.get("after") ?? undefined;
    const page = await getRecentMedia(token.accessToken, token.igAccountId, { limit: 24, after });
    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 502 });
  }
}
