import "server-only";
import { decrypt, encrypt } from "./crypto";
import { prisma } from "./db";
import {
  debugToken,
  describeError,
  exchangeCodeForToken,
  findInstagramAccountId,
  getInstagramProfile,
  getMetaConfig,
  getSystemUser,
  getWebhookSubscriptions,
  InstagramApiError,
  subscribeWebhooks,
  tokenInvalidReason,
  WEBHOOK_FIELDS,
  type InstagramProfile,
  type TokenDebugInfo,
} from "./instagram";

/** Bound into the ciphertext as AAD so this blob can only be decrypted as an IG token. */
const TOKEN_CONTEXT = "instagram:access_token";

/** Everything about the account EXCEPT the token. Safe to pass to UI. */
export type InstagramAccountSummary = {
  igAccountId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  clientBusinessId: string | null;
  tokenStatus: "VALID" | "INVALID";
  tokenStatusReason: string | null;
  tokenCheckedAt: Date | null;
  webhookFields: string[];
  webhookCheckedAt: Date | null;
  webhookError: string | null;
  connectedAt: Date;
};

const summarySelect = {
  igAccountId: true,
  username: true,
  name: true,
  profilePictureUrl: true,
  tokenExpiresAt: true,
  scopes: true,
  clientBusinessId: true,
  tokenStatus: true,
  tokenStatusReason: true,
  tokenCheckedAt: true,
  webhookFields: true,
  webhookCheckedAt: true,
  webhookError: true,
  connectedAt: true,
} as const;

function profileFields(p: InstagramProfile) {
  return { username: p.username, name: p.name ?? null, profilePictureUrl: p.profilePictureUrl ?? null };
}

export async function getInstagramAccount(): Promise<InstagramAccountSummary | null> {
  return prisma.instagramAccount.findFirst({ select: summarySelect });
}

/** For the app-wide red banner: non-null when the stored token has been found invalid. */
export async function getTokenAlert(): Promise<{ username: string; reason: string } | null> {
  const row = await prisma.instagramAccount.findFirst({
    where: { tokenStatus: "INVALID" },
    select: { username: true, tokenStatusReason: true },
  });
  return row ? { username: row.username, reason: row.tokenStatusReason ?? "The access token is no longer valid." } : null;
}

/**
 * Complete Unified Login: code → system-user token → validate → find IG account → profile → store.
 */
export async function connectWithAuthorizationCode(code: string): Promise<InstagramAccountSummary> {
  const { appId, configId } = getMetaConfig();
  const token = await exchangeCodeForToken(code);

  const debug = await debugToken(token.accessToken);
  if (!debug.isValid) throw new Error(`Meta returned a token that isn't valid: ${debug.error?.message ?? "unknown reason"}`);
  if (debug.appId && debug.appId !== appId) throw new Error("Token was issued for a different app than META_APP_ID.");
  if (debug.type && debug.type !== "SYSTEM_USER") {
    console.warn(
      `[instagram] token type is ${debug.type}, expected SYSTEM_USER. Set the login configuration's token type to "System-user access token".`,
    );
  }

  const igAccountId = await findInstagramAccountId(token.accessToken, debug);
  const profile = await getInstagramProfile(token.accessToken, igAccountId);
  const systemUser = await getSystemUser(token.accessToken).catch(() => null); // informational only

  const now = new Date();
  const data = {
    ...profileFields(profile),
    accessTokenEnc: encrypt(token.accessToken, TOKEN_CONTEXT),
    tokenExpiresAt: debug.expiresAt ?? (token.expiresIn ? new Date(now.getTime() + token.expiresIn * 1000) : null),
    scopes: debug.scopes,
    clientBusinessId: systemUser?.clientBusinessId ?? null,
    systemUserId: systemUser?.id ?? null,
    configId,
    tokenStatus: "VALID" as const,
    tokenStatusReason: null,
    tokenCheckedAt: now,
    connectedAt: now,
  };

  // Single-user app: connecting an account replaces any previously connected one.
  const [, account] = await prisma.$transaction([
    prisma.instagramAccount.deleteMany({ where: { igAccountId: { not: profile.id } } }),
    prisma.instagramAccount.upsert({
      where: { igAccountId: profile.id },
      create: { igAccountId: profile.id, ...data },
      update: data,
      select: summarySelect,
    }),
  ]);
  console.info(
    `[instagram] connected @${account.username} (ig_account_id=${account.igAccountId}, ` +
      `business=${account.clientBusinessId ?? "?"}, expires=${account.tokenExpiresAt?.toISOString() ?? "never"})`,
  );

  // Subscribe to webhooks right away. Non-fatal: the result shows on Settings with a Resubscribe button.
  await syncWebhookSubscription();
  return (await getInstagramAccount()) ?? account;
}

/** The connected account's identity, for recognising our own activity in webhooks. */
export async function getOwnAccount(): Promise<{ igAccountId: string; username: string } | null> {
  return prisma.instagramAccount.findFirst({ select: { igAccountId: true, username: true } });
}

export type WebhookSyncResult =
  | { ok: true; fields: string[]; missing: string[] }
  | { ok: false; error: string };

/**
 * Subscribe the account to WEBHOOK_FIELDS, then read the subscription back to confirm.
 * Stores the outcome on the account row. Never throws.
 */
export async function syncWebhookSubscription(): Promise<WebhookSyncResult> {
  let token: Awaited<ReturnType<typeof getAccessToken>>;
  try {
    token = await getAccessToken();
  } catch (err) {
    // e.g. TOKEN_ENCRYPTION_KEY changed: record it so Settings shows why.
    console.error("[instagram] webhook subscribe: cannot read token:", err);
    const error = describeError(err);
    await prisma.instagramAccount.updateMany({ data: { webhookError: `Subscribe failed: ${error}`, webhookCheckedAt: new Date() } });
    return { ok: false, error };
  }
  if (!token) return { ok: false, error: "No Instagram account connected." };

  const now = new Date();
  const record = (data: { webhookFields?: string[]; webhookError: string | null }) =>
    prisma.instagramAccount.update({ where: { igAccountId: token.igAccountId }, data: { ...data, webhookCheckedAt: now } });

  try {
    await subscribeWebhooks(token.accessToken, token.igAccountId);
  } catch (err) {
    const error = describeError(err);
    await record({ webhookError: `Subscribe failed: ${error}` });
    return { ok: false, error };
  }

  // Confirm by reading it back. If the read isn't supported, trust the successful POST.
  let fields: string[] = [...WEBHOOK_FIELDS];
  try {
    const current = await getWebhookSubscriptions(token.accessToken, token.igAccountId);
    if (current.length) fields = current;
  } catch {
    console.warn("[instagram] couldn't read back webhook subscriptions; assuming the subscribe call applied");
  }
  const missing = WEBHOOK_FIELDS.filter((f) => !fields.includes(f));
  await record({
    webhookFields: fields,
    webhookError: missing.length ? `Not subscribed to: ${missing.join(", ")}` : null,
  });
  console.info(`[instagram] webhook fields: ${fields.join(", ")}${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
  return { ok: true, fields, missing };
}

/** Decrypted token for Graph API calls. Server-only; never send it to the client. */
export async function getAccessToken(): Promise<{ igAccountId: string; accessToken: string } | null> {
  const row = await prisma.instagramAccount.findFirst({ select: { igAccountId: true, accessTokenEnc: true } });
  if (!row) return null;
  return { igAccountId: row.igAccountId, accessToken: decrypt(row.accessTokenEnc, TOKEN_CONTEXT) };
}

export async function disconnectInstagram(): Promise<void> {
  const { count } = await prisma.instagramAccount.deleteMany({});
  if (count) console.info("[instagram] disconnected; stored token deleted");
}

// ── Health check ────────────────────────────────────────────────────────────

export type HealthResult =
  | { status: "no_account" }
  | { status: "valid"; expiresAt: string | null; scopes: string[] }
  | { status: "invalid"; reason: string }
  /** Couldn't verify (Meta unreachable, rate limited, bad app credentials). Stored status unchanged. */
  | { status: "unknown"; reason: string };

async function markInvalid(igAccountId: string, reason: string) {
  const prev = await prisma.instagramAccount.findUnique({ where: { igAccountId }, select: { tokenStatus: true } });
  await prisma.instagramAccount.update({
    where: { igAccountId },
    data: { tokenStatus: "INVALID", tokenStatusReason: reason, tokenCheckedAt: new Date() },
  });
  if (prev?.tokenStatus !== "INVALID") console.error(`[instagram] token is now INVALID: ${reason}`);
}

/** Inspect the stored token with /debug_token and record the result. Safe to call often. */
export async function checkTokenHealth(): Promise<HealthResult> {
  const row = await prisma.instagramAccount.findFirst();
  if (!row) return { status: "no_account" };

  let debug: TokenDebugInfo;
  try {
    debug = await debugToken(decrypt(row.accessTokenEnc, TOKEN_CONTEXT));
  } catch (err) {
    // Not proof the token is bad (network, rate limit, wrong app secret, decrypt key): don't flip status.
    if (!(err instanceof InstagramApiError)) console.error("[instagram] health check failed:", err);
    return { status: "unknown", reason: describeError(err) };
  }

  const reason = tokenInvalidReason(debug, row.igAccountId, row.username);
  if (reason) {
    await markInvalid(row.igAccountId, reason);
    return { status: "invalid", reason };
  }

  await prisma.instagramAccount.update({
    where: { id: row.id },
    data: {
      tokenStatus: "VALID",
      tokenStatusReason: null,
      tokenCheckedAt: new Date(),
      tokenExpiresAt: debug.expiresAt,
      scopes: debug.scopes,
    },
  });
  if (row.tokenStatus === "INVALID") console.info("[instagram] token is VALID again");
  return { status: "valid", expiresAt: debug.expiresAt?.toISOString() ?? null, scopes: debug.scopes };
}

export type TestConnectionResult = { ok: true; profile: InstagramProfile } | { ok: false; error: string };

/** Health check + live profile fetch. Updates the stored username/picture on success. */
export async function testInstagramConnection(): Promise<TestConnectionResult> {
  try {
    const health = await checkTokenHealth();
    if (health.status === "no_account") return { ok: false, error: "No Instagram account connected." };
    if (health.status === "invalid") return { ok: false, error: health.reason };

    const token = await getAccessToken();
    if (!token) return { ok: false, error: "No Instagram account connected." };
    try {
      const profile = await getInstagramProfile(token.accessToken, token.igAccountId);
      await prisma.instagramAccount.update({ where: { igAccountId: token.igAccountId }, data: profileFields(profile) });
      return { ok: true, profile };
    } catch (err) {
      if (err instanceof InstagramApiError && err.isTokenError) await markInvalid(token.igAccountId, err.userMessage);
      throw err;
    }
  } catch (error) {
    // InstagramApiError is already logged by the client; log anything else (e.g. decrypt failures).
    if (!(error instanceof InstagramApiError)) console.error("[instagram] test connection failed:", error);
    return { ok: false, error: describeError(error) };
  }
}
