import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Routes that skip the session check:
 *  - /api/webhooks/*  Meta must reach these without a session.
 *  - /api/cron/*      Called by a scheduler; each route verifies CRON_SECRET itself.
 */
const SESSIONLESS_PREFIXES = ["/api/webhooks", "/api/cron"];

function isSessionless(pathname: string): boolean {
  return SESSIONLESS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isSessionless(pathname)) return NextResponse.next();

  const authed = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return authed ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("from", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next.js static assets and root-level public files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
