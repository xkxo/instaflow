"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionRedirect } from "@/lib/action-redirect";
import { requireAuth } from "@/lib/auth";
import { buildLoginUrl, getMissingMetaConfig } from "@/lib/instagram";
import { disconnectInstagram, syncWebhookSubscription, testInstagramConnection } from "@/lib/instagram-account";
import { OAUTH_CALLBACK_PATH, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/instagram-oauth";

// Server actions are reachable by POST, so each one re-checks the session itself.

export async function connectInstagram(): Promise<void> {
  await requireAuth();
  if (getMissingMetaConfig().length) await actionRedirect("/settings?instagram=not_configured");

  const state = randomBytes(32).toString("base64url");
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on the top-level redirect back from facebook.com
    path: OAUTH_CALLBACK_PATH,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  redirect(buildLoginUrl(state));
}

export async function disconnect(): Promise<void> {
  await requireAuth();
  await disconnectInstagram();
  revalidatePath("/settings");
  await actionRedirect("/settings?instagram=disconnected");
}

export type ResubscribeState = { ok: boolean; message: string } | undefined;

export async function resubscribe(_prev: ResubscribeState): Promise<ResubscribeState> {
  await requireAuth();
  const result = await syncWebhookSubscription();
  revalidatePath("/settings");
  if (!result.ok) return { ok: false, message: result.error };
  return result.missing.length
    ? { ok: false, message: `Subscribed, but Meta reports these fields missing: ${result.missing.join(", ")}` }
    : { ok: true, message: `Subscribed to ${result.fields.join(", ")}` };
}

export type TestState =
  | { ok: true; message: string; checkedAt: string }
  | { ok: false; message: string; checkedAt: string }
  | undefined;

export async function testConnection(_prev: TestState): Promise<TestState> {
  await requireAuth();
  const result = await testInstagramConnection();
  const checkedAt = new Date().toISOString();
  revalidatePath("/settings");
  if (!result.ok) return { ok: false, message: result.error, checkedAt };

  const p = result.profile;
  const stats = [
    p.followersCount !== undefined && `${p.followersCount.toLocaleString("en")} followers`,
    p.mediaCount !== undefined && `${p.mediaCount.toLocaleString("en")} posts`,
  ].filter(Boolean);
  return {
    ok: true,
    message: `Connected as @${p.username}${stats.length ? ` · ${stats.join(" · ")}` : ""}`,
    checkedAt,
  };
}
