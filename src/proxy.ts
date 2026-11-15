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

/**
 * Origin the browser used. Behind a reverse proxy: X-Forwarded-Host (Apache/nginx) and
 * X-Forwarded-Proto (Cloudflare/nginx). Direct access: the request URL itself.
 */
function publicOrigin(request: NextRequest): string {
  const first = (v: string | null) => v?.split(",")[0].trim() || null;
  const host = first(request.headers.get("x-forwarded-host"));
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return request.nextUrl.origin;
  const proto = first(request.headers.get("x-forwarded-proto"));
  return `${proto === "https" || proto === "http" ? proto : request.nextUrl.protocol.replace(":", "")}://${host}`;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isSessionless(pathname)) return NextResponse.next();

  const authed = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  // Redirect to basePath + path on the PUBLIC origin (behind Apache/Cloudflare the app itself
  // only sees 127.0.0.1 over http). nextUrl.pathname excludes the basePath.
  const redirectTo = (path: string, query?: Record<string, string>) => {
    const qs = query ? `?${new URLSearchParams(query)}` : "";
    return NextResponse.redirect(`${publicOrigin(request)}${request.nextUrl.basePath}${path}${qs}`, 307);
  };

  if (pathname === "/login") {
    return authed ? redirectTo("/") : NextResponse.next();
  }

  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return redirectTo("/login", pathname !== "/" ? { from: pathname + search } : undefined);
}

export const config = {
  // Everything except Next.js static assets, the app icon and root-level public files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
