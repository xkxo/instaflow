import "server-only";
import { createHmac } from "node:crypto";

/**
 * Typed client for the Instagram API with Unified Login.
 *
 * - Login: Facebook Login for Business with a login configuration (`config_id`), not scopes.
 * - Token: Business Integration System User access token (owned by the business portfolio).
 * - Host: graph.facebook.com. NOT graph.instagram.com / Business Login for Instagram.
 *
 * Every call goes through `graphRequest()`, which turns Meta error payloads into
 * `InstagramApiError` and logs code, subcode, type and fbtrace_id. Tokens and the app
 * secret are never logged. Calls made with a user/system-user token carry `appsecret_proof`.
 */

// ── Config ──────────────────────────────────────────────────────────────────

/** The one place the Graph API version is set. */
export const GRAPH_API_VERSION = "v27.0";

/**
 * Test hook: point Graph calls at a local mock Meta server. Ignored in production builds, so it
 * can never redirect real traffic.
 */
const GRAPH_HOST =
  process.env.NODE_ENV !== "production" && process.env.META_GRAPH_HOST_OVERRIDE
    ? process.env.META_GRAPH_HOST_OVERRIDE.replace(/\/+$/, "")
    : "https://graph.facebook.com";
const GRAPH_URL = `${GRAPH_HOST}/${GRAPH_API_VERSION}`;
const LOGIN_DIALOG_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;
const REQUEST_TIMEOUT_MS = 15_000;

/** Permissions the login configuration should grant (configured in the App Dashboard, not sent). */
export const EXPECTED_PERMISSIONS = ["instagram_basic", "instagram_manage_messages", "instagram_manage_comments"] as const;

const REQUIRED_ENV = ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_REDIRECT_URI"] as const;

export type MetaConfig = { appId: string; appSecret: string; configId: string; redirectUri: string };

/** Names of required Meta env vars that are missing (empty array = fully configured). */
export function getMissingMetaConfig(): string[] {
  return REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
}

export function getMetaConfig(): MetaConfig {
  const missing = getMissingMetaConfig();
  if (missing.length) throw new Error(`Instagram is not configured. Missing env vars: ${missing.join(", ")}`);
  return {
    appId: process.env.META_APP_ID!.trim(),
    appSecret: process.env.META_APP_SECRET!.trim(),
    configId: process.env.META_LOGIN_CONFIG_ID!.trim(),
    redirectUri: process.env.META_REDIRECT_URI!.trim(),
  };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type InstagramErrorInfo = {
  /** Short label for logs, e.g. "GET /me". Never contains tokens. */
  endpoint: string;
  /** HTTP status, or 0 for network errors / timeouts. */
  httpStatus: number;
  code?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
  metaMessage: string;
};

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export class InstagramApiError extends Error {
  readonly info: InstagramErrorInfo;

  constructor(info: InstagramErrorInfo) {
    super(`${info.endpoint} failed: ${info.metaMessage}`);
    this.name = "InstagramApiError";
    this.info = info;
  }

  get code() {
    return this.info.code;
  }
  get isTokenError() {
    return this.info.code === 190;
  }
  get isRateLimited() {
    return this.info.code !== undefined && RATE_LIMIT_CODES.has(this.info.code);
  }
  get isPermissionError() {
    const c = this.info.code;
    return c === 10 || (c !== undefined && c >= 200 && c < 300);
  }
  /** Network failures, timeouts, 5xx, rate limits and Meta's "temporary" codes. */
  get isTransient() {
    const { httpStatus, code } = this.info;
    return httpStatus === 0 || httpStatus >= 500 || this.isRateLimited || code === 1 || code === 2;
  }

  /** Plain-English hint for well-known Meta error codes. */
  get hint(): string | undefined {
    const { code, subcode, httpStatus, metaMessage } = this.info;
    if (httpStatus === 0) return "Network error or timeout reaching Meta. Try again.";
    // Meta reports bad app credentials with several codes (101, 190, 100); match on the message.
    if (code === 101 || code === 1001 || /validating application|appsecret_proof|client secret/i.test(metaMessage)) {
      return "Invalid app credentials. Check META_APP_ID / META_APP_SECRET (use the Meta app's, not the Instagram app's).";
    }
    if (code === 190) {
      if (subcode === 463) return "Access token expired. Reconnect Instagram.";
      if (subcode === 460) return "Password changed on the account that granted access. Reconnect Instagram.";
      if (subcode === 458) return "The app was removed from the business. Reconnect Instagram.";
      return "Access token is no longer valid (app removed from the business, or the account moved). Reconnect Instagram.";
    }
    if (code === 100 && subcode === 36008) return "redirect_uri doesn't match the one used for login. Check META_REDIRECT_URI.";
    if (code === 100 && (subcode === 36007 || subcode === 36009)) return "Authorization code is invalid or was already used. Try connecting again.";
    if (this.isRateLimited) return "Rate limited by Meta. Wait a while before retrying.";
    if (this.isPermissionError) {
      return "Missing permission. Check the login configuration's permissions and that your account has a role on the app.";
    }
    if (code === 100) return "Invalid parameter, or the object isn't accessible with this token.";
    if (code === 1 || code === 2) return "Temporary Meta error. Try again shortly.";
    if (code === 368) return "Temporarily blocked by Meta for policy reasons.";
    return undefined;
  }

  /** Message safe to show in the UI. */
  get userMessage(): string {
    const { code, subcode } = this.info;
    const codePart = code !== undefined ? ` (Meta error ${code}${subcode ? `/${subcode}` : ""})` : "";
    return `${this.hint ?? this.info.metaMessage}${codePart}`;
  }
}

/** Turns any thrown value into a message that's safe to show in the UI. */
export function describeError(error: unknown): string {
  if (error instanceof InstagramApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

function parseError(endpoint: string, httpStatus: number, body: unknown, rawText: string): InstagramApiError {
  const e = (body as MetaErrorBody | undefined)?.error;
  if (e && typeof e === "object") {
    return new InstagramApiError({
      endpoint,
      httpStatus,
      code: e.code,
      subcode: e.error_subcode,
      type: e.type,
      fbtraceId: e.fbtrace_id,
      metaMessage: e.error_user_msg || e.message || "Unknown Graph API error",
    });
  }
  return new InstagramApiError({
    endpoint,
    httpStatus,
    metaMessage: `Unexpected response (HTTP ${httpStatus}): ${rawText.slice(0, 200) || "<empty>"}`,
  });
}

function logError(err: InstagramApiError) {
  const { endpoint, httpStatus, code, subcode, type, fbtraceId, metaMessage } = err.info;
  const parts = [
    httpStatus ? `HTTP ${httpStatus}` : "network",
    code !== undefined && `code=${code}`,
    subcode !== undefined && `subcode=${subcode}`,
    type && `type=${type}`,
    fbtraceId && `fbtrace_id=${fbtraceId}`,
  ].filter(Boolean);
  console.error(
    `[instagram] ${endpoint} failed: ${parts.join(" ")} | ${metaMessage}${err.hint ? ` | hint: ${err.hint}` : ""}`,
  );
}

// ── Transport ───────────────────────────────────────────────────────────────

type Auth =
  | { kind: "token"; accessToken: string } // user / system-user token, signed with appsecret_proof
  | { kind: "app" } // app access token (APP_ID|APP_SECRET), for /debug_token
  | { kind: "none" };

function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

async function graphRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string>,
  auth: Auth,
  jsonBody?: unknown,
): Promise<T> {
  const endpoint = `${method} ${path}`;
  const url = new URL(GRAPH_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  if (auth.kind !== "none") {
    const { appId, appSecret } = getMetaConfig();
    if (auth.kind === "token") {
      url.searchParams.set("access_token", auth.accessToken);
      url.searchParams.set("appsecret_proof", appSecretProof(auth.accessToken, appSecret));
    } else {
      url.searchParams.set("access_token", `${appId}|${appSecret}`);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(jsonBody !== undefined
        ? { body: JSON.stringify(jsonBody), headers: { "content-type": "application/json" } }
        : {}),
    });
  } catch (cause) {
    const err = new InstagramApiError({
      endpoint,
      httpStatus: 0,
      metaMessage: cause instanceof Error ? `${cause.name}: ${cause.message}` : "Network error",
    });
    logError(err);
    throw err;
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (!res.ok || body === undefined || (typeof body === "object" && body !== null && "error" in body)) {
    const err = parseError(endpoint, res.status, body, text);
    logError(err);
    throw err;
  }
  return body as T;
}

// ── Login (Facebook Login for Business) ─────────────────────────────────────

/** Login dialog URL. Permissions and assets come from the login configuration (config_id). */
export function buildLoginUrl(state: string): string {
  const { appId, configId, redirectUri } = getMetaConfig();
  const url = new URL(LOGIN_DIALOG_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("config_id", configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export type ExchangedToken = {
  accessToken: string;
  tokenType?: string;
  /** Seconds until expiry, or null if Meta didn't send one (system-user tokens set to "Never"). */
  expiresIn: number | null;
};

/** Exchange the login `code` for a Business Integration System User access token. Codes are single-use. */
export async function exchangeCodeForToken(code: string): Promise<ExchangedToken> {
  const { appId, appSecret, redirectUri } = getMetaConfig();
  type Raw = { access_token: string; token_type?: string; expires_in?: number };
  const raw = await graphRequest<Raw>(
    "GET",
    "/oauth/access_token",
    // redirect_uri must be byte-identical to the one used in the login dialog.
    { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    { kind: "none" },
  );
  return {
    accessToken: raw.access_token,
    tokenType: raw.token_type,
    expiresIn: raw.expires_in && raw.expires_in > 0 ? raw.expires_in : null,
  };
}

// ── Token inspection ────────────────────────────────────────────────────────

export type TokenDebugInfo = {
  isValid: boolean;
  appId?: string;
  type?: string;
  /** null = never expires. */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  scopes: string[];
  /** Per-permission asset IDs. `targetIds` undefined = applies to all assets. */
  granularScopes: { scope: string; targetIds?: string[] }[];
  /** Why the token is invalid, when Meta says so. */
  error?: { code?: number; subcode?: number; message?: string };
};

const unix = (s?: number) => (s && s > 0 ? new Date(s * 1000) : null);

/** Inspect a token with the app access token. Works even when the input token is invalid. */
export async function debugToken(accessToken: string): Promise<TokenDebugInfo> {
  type Raw = {
    data: {
      app_id?: string;
      type?: string;
      is_valid: boolean;
      expires_at?: number;
      data_access_expires_at?: number;
      scopes?: string[];
      granular_scopes?: { scope: string; target_ids?: string[] }[];
      error?: { code?: number; subcode?: number; message?: string };
    };
  };
  const { data } = await graphRequest<Raw>("GET", "/debug_token", { input_token: accessToken }, { kind: "app" });
  return {
    isValid: data.is_valid,
    appId: data.app_id,
    type: data.type,
    expiresAt: unix(data.expires_at),
    dataAccessExpiresAt: unix(data.data_access_expires_at),
    scopes: data.scopes ?? [],
    granularScopes: (data.granular_scopes ?? []).map((g) => ({ scope: g.scope, targetIds: g.target_ids })),
    error: data.error,
  };
}

// ── Graph API ───────────────────────────────────────────────────────────────

export type SystemUser = { id: string; name?: string; clientBusinessId?: string };

/** With a system-user token, /me is the business integration system user (not the IG account). */
export async function getSystemUser(accessToken: string): Promise<SystemUser> {
  type Raw = { id: string; name?: string; client_business_id?: string };
  const raw = await graphRequest<Raw>("GET", "/me", { fields: "id,name,client_business_id" }, { kind: "token", accessToken });
  return { id: raw.id, name: raw.name, clientBusinessId: raw.client_business_id };
}

export type AssignedInstagramAccount = { id: string; username?: string };

export async function getAssignedInstagramAccounts(accessToken: string): Promise<AssignedInstagramAccount[]> {
  type Raw = { data?: { id: string; username?: string }[] };
  const raw = await graphRequest<Raw>(
    "GET",
    "/me/assigned_instagram_accounts",
    { fields: "id,username" },
    { kind: "token", accessToken },
  );
  return (raw.data ?? []).map((a) => ({ id: String(a.id), username: a.username }));
}

/** Instagram permissions whose granular target_ids identify the shared IG account(s). */
const IG_SCOPES = new Set<string>(["instagram_basic", ...EXPECTED_PERMISSIONS]);

/** IG account IDs the token was granted, per /debug_token's granular scopes. */
export function instagramIdsFromDebug(info: TokenDebugInfo): string[] {
  const ids = new Set<string>();
  for (const g of info.granularScopes) {
    if (IG_SCOPES.has(g.scope)) g.targetIds?.forEach((id) => ids.add(String(id)));
  }
  return [...ids];
}

/**
 * Decide whether a token is still usable for `igAccountId`, based on /debug_token.
 * Returns a human-readable reason if not, or null if it's fine.
 */
export function tokenInvalidReason(debug: TokenDebugInfo, igAccountId: string, username: string): string | null {
  if (!debug.isValid) {
    return debug.error?.message
      ? `Meta reports the token is invalid: ${debug.error.message}`
      : "Meta reports the token is no longer valid (access may have been removed from the business).";
  }
  if (debug.expiresAt && debug.expiresAt.getTime() <= Date.now()) return "The access token has expired.";
  const granted = instagramIdsFromDebug(debug);
  if (granted.length && !granted.includes(igAccountId)) {
    return `@${username} is no longer shared with the app (removed or moved to another business portfolio).`;
  }
  return null;
}

/**
 * Find the Instagram account this token can act on: /me/assigned_instagram_accounts first,
 * then the token's granted assets from /debug_token.
 */
export async function findInstagramAccountId(accessToken: string, debug?: TokenDebugInfo): Promise<string> {
  try {
    const assigned = await getAssignedInstagramAccounts(accessToken);
    if (assigned.length) {
      if (assigned.length > 1) {
        console.warn(`[instagram] token has ${assigned.length} assigned IG accounts; using the first (${assigned[0].id})`);
      }
      return assigned[0].id;
    }
    console.warn("[instagram] /me/assigned_instagram_accounts returned no accounts; falling back to /debug_token");
  } catch (err) {
    // Only fall back if the edge itself is the problem; a dead token won't work in debug_token either.
    if (!(err instanceof InstagramApiError) || err.isTokenError || err.isTransient) throw err;
    console.warn("[instagram] /me/assigned_instagram_accounts failed; falling back to /debug_token");
  }

  const ids = instagramIdsFromDebug(debug ?? (await debugToken(accessToken)));
  if (!ids.length) {
    throw new Error(
      "No Instagram account was shared during login. Make sure the login configuration's asset type is " +
        "Instagram account and that you selected your account when connecting.",
    );
  }
  return ids[0];
}

// ── Webhook subscriptions ───────────────────────────────────────────────────

/** Webhook fields the app needs for the connected account. */
export const WEBHOOK_FIELDS = ["comments", "messages", "messaging_postbacks"] as const;

/** Subscribe the IG account to this app's webhooks (Unified Login: system-user token). */
export async function subscribeWebhooks(
  accessToken: string,
  igAccountId: string,
  fields: readonly string[] = WEBHOOK_FIELDS,
): Promise<void> {
  const raw = await graphRequest<{ success?: boolean }>(
    "POST",
    `/${encodeURIComponent(igAccountId)}/subscribed_apps`,
    { subscribed_fields: fields.join(",") },
    { kind: "token", accessToken },
  );
  if (raw.success !== true) throw new Error("Meta did not confirm the webhook subscription (success != true).");
}

/** Fields this app is currently subscribed to for the IG account. */
export async function getWebhookSubscriptions(accessToken: string, igAccountId: string): Promise<string[]> {
  type Field = string | { name?: string };
  type Raw = { data?: { id?: string; subscribed_fields?: Field[] }[] };
  const raw = await graphRequest<Raw>(
    "GET",
    `/${encodeURIComponent(igAccountId)}/subscribed_apps`,
    {},
    { kind: "token", accessToken },
  );
  const { appId } = getMetaConfig();
  const apps = raw.data ?? [];
  const ours = apps.find((a) => a.id === appId) ?? (apps.length === 1 ? apps[0] : undefined);
  return (ours?.subscribed_fields ?? [])
    .map((f) => (typeof f === "string" ? f : f.name))
    .filter((f): f is string => !!f);
}

// ── Messaging ───────────────────────────────────────────────────────────────

/** `{ comment_id }` = private reply to a comment (one per comment, ≤ 7 days). `{ id }` = IGSID. */
export type MessageRecipient = { comment_id: string } | { id: string };

export type QuickReply = { content_type: "text"; title: string; payload: string };

export type PostbackButton = { type: "postback"; title: string; payload: string };

export type OutgoingMessage =
  | { text: string; quick_replies?: QuickReply[] }
  | {
      attachment: {
        type: "template";
        payload:
          | {
              template_type: "generic";
              elements: { title: string; subtitle?: string; buttons: { type: "web_url"; url: string; title: string }[] }[];
            }
          // Text (≤ 640 chars) with 1–3 buttons; shown on web and mobile, unlike quick replies.
          | { template_type: "button"; text: string; buttons: PostbackButton[] };
      };
    };

/** POST /{ig-account-id}/messages. */
export async function sendMessage(
  accessToken: string,
  igAccountId: string,
  recipient: MessageRecipient,
  message: OutgoingMessage,
): Promise<{ messageId?: string; recipientId?: string }> {
  const raw = await graphRequest<{ message_id?: string; recipient_id?: string }>(
    "POST",
    `/${encodeURIComponent(igAccountId)}/messages`,
    {},
    { kind: "token", accessToken },
    { recipient, message },
  );
  return { messageId: raw.message_id, recipientId: raw.recipient_id };
}

/** POST /{comment-id}/replies: public reply under a comment. */
export async function replyToComment(accessToken: string, commentId: string, message: string): Promise<{ id?: string }> {
  return graphRequest<{ id?: string }>(
    "POST",
    `/${encodeURIComponent(commentId)}/replies`,
    { message },
    { kind: "token", accessToken },
  );
}

export type FollowProfile = { name?: string; username?: string; followsBusiness?: boolean };

/**
 * GET /{IGSID}?fields=name,username,is_user_follow_business. Requires the user's consent,
 * which they give by messaging the account (e.g. tapping a quick reply). Comments alone don't count.
 */
export async function getFollowProfile(accessToken: string, igsid: string): Promise<FollowProfile> {
  type Raw = { name?: string; username?: string; is_user_follow_business?: boolean };
  const raw = await graphRequest<Raw>(
    "GET",
    `/${encodeURIComponent(igsid)}`,
    { fields: "name,username,is_user_follow_business" },
    { kind: "token", accessToken },
  );
  return { name: raw.name, username: raw.username, followsBusiness: raw.is_user_follow_business };
}

// ── Messaging user profile ──────────────────────────────────────────────────

/** Profile of someone who messaged the account (Instagram-scoped ID from a messaging webhook). */
export async function getMessagingUserProfile(
  accessToken: string,
  igsid: string,
): Promise<{ username?: string; name?: string }> {
  type Raw = { username?: string; name?: string };
  const raw = await graphRequest<Raw>(
    "GET",
    `/${encodeURIComponent(igsid)}`,
    { fields: "username,name" },
    { kind: "token", accessToken },
  );
  return { username: raw.username, name: raw.name };
}

// ── Media ───────────────────────────────────────────────────────────────────

export type InstagramMedia = {
  id: string;
  caption?: string;
  /** IMAGE | VIDEO | CAROUSEL_ALBUM */
  mediaType?: string;
  /** FEED | REELS | STORY | AD */
  productType?: string;
  /** Best image to show: thumbnail for videos/reels, media URL otherwise. Short-lived CDN URL. */
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: string;
};

export async function getRecentMedia(
  accessToken: string,
  igAccountId: string,
  { limit = 24, after }: { limit?: number; after?: string } = {},
): Promise<{ items: InstagramMedia[]; nextCursor: string | null }> {
  type Raw = {
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
    }[];
    paging?: { cursors?: { after?: string }; next?: string };
  };
  const params: Record<string, string> = {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
    limit: String(Math.min(Math.max(limit, 1), 50)),
  };
  if (after) params.after = after;
  const raw = await graphRequest<Raw>("GET", `/${encodeURIComponent(igAccountId)}/media`, params, {
    kind: "token",
    accessToken,
  });
  return {
    items: (raw.data ?? []).map((m) => ({
      id: String(m.id),
      caption: m.caption,
      mediaType: m.media_type,
      productType: m.media_product_type,
      thumbnailUrl: m.media_type === "VIDEO" ? (m.thumbnail_url ?? m.media_url) : (m.media_url ?? m.thumbnail_url),
      permalink: m.permalink,
      timestamp: m.timestamp,
    })),
    // Only offer "load more" when Meta says there's a next page.
    nextCursor: raw.paging?.next ? (raw.paging.cursors?.after ?? null) : null,
  };
}

// ── Profile ─────────────────────────────────────────────────────────────────

export type InstagramProfile = {
  /** Instagram professional account ID used for all Graph calls (and webhook `entry.id`). */
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
};

export async function getInstagramProfile(accessToken: string, igAccountId: string): Promise<InstagramProfile> {
  type Raw = {
    id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
  };
  const raw = await graphRequest<Raw>(
    "GET",
    `/${encodeURIComponent(igAccountId)}`,
    { fields: "id,username,name,profile_picture_url,followers_count,media_count" },
    { kind: "token", accessToken },
  );
  return {
    id: String(raw.id),
    username: raw.username,
    name: raw.name || undefined,
    profilePictureUrl: raw.profile_picture_url,
    followersCount: raw.followers_count,
    mediaCount: raw.media_count,
  };
}
