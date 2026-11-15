import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { safeEqual } from "@/lib/crypto";
import { getMetaConfig, getMissingMetaConfig } from "@/lib/instagram";
import { connectWithAuthorizationCode } from "@/lib/instagram-account";
import { OAUTH_CALLBACK_PATH, OAUTH_STATE_COOKIE, type ConnectResult } from "@/lib/instagram-oauth";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect target for the Instagram API with Unified Login (Facebook Login for Business).
 * META_REDIRECT_URI must point here and match the login configuration's redirect URL.
 * proxy.ts already requires a session for /api/*; checked again here as defense in depth.
 */
export async function GET(request: NextRequest) {
  // Build redirects from META_REDIRECT_URI's origin so they land on the same host the
  // session cookie belongs to, even behind a tunnel or reverse proxy.
  const base = getMissingMetaConfig().length ? request.url : getMetaConfig().redirectUri;

  const finish = (result: ConnectResult) => {
    const res = NextResponse.redirect(new URL(`/settings?instagram=${result}`, base), 303);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_CALLBACK_PATH, maxAge: 0 });
    return res;
  };

  if (!(await isAuthenticated())) return NextResponse.redirect(new URL("/login", base));
  if (getMissingMetaConfig().length) return finish("not_configured");

  const params = request.nextUrl.searchParams;

  // User cancelled or Meta rejected the request.
  const oauthError = params.get("error");
  if (oauthError) {
    const reason = params.get("error_reason") ?? "";
    console.warn(
      `[instagram] authorization returned error=${oauthError} reason=${reason} description=${params.get("error_description") ?? ""}`,
    );
    return finish(reason === "user_denied" || oauthError === "access_denied" ? "denied" : "error");
  }

  // CSRF: the state must match the one we stored in the cookie when starting the flow.
  const state = params.get("state");
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expected || !safeEqual(state, expected)) {
    console.warn("[instagram] OAuth state mismatch or expired; ignoring callback");
    return finish("state_mismatch");
  }

  const code = params.get("code");
  if (!code) {
    console.warn("[instagram] OAuth callback missing code");
    return finish("error");
  }

  try {
    await connectWithAuthorizationCode(code);
    return finish("connected");
  } catch (error) {
    // InstagramApiError details are already logged by lib/instagram.ts.
    if (!(error instanceof Error && error.name === "InstagramApiError")) {
      console.error("[instagram] connect failed:", error);
    }
    return finish("error");
  }
}
