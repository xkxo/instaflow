import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { describeError, InstagramApiError, type MessageRecipient, type OutgoingMessage } from "../instagram";
import {
  decodePayload,
  deliveryCard,
  deliveryText,
  humanDelayMs,
  needsFollowCheck,
  notFollowingMessage,
  openingMessage,
  pickAutomation,
  pickPublicReply,
  privateReplyExpired,
  tapForStep,
  transition,
  type Tap,
} from "./machine";
import type { Messenger } from "./messenger";

/**
 * Flow engine: one handler per step. Every handler is idempotent (guards on the run's current
 * step) and performs at most ONE Instagram side effect, so a retried job never double-sends.
 * Real runs are driven by the job queue (jobs.ts); dry runs by simulate.ts with a fake Messenger.
 */

export type JobType =
  | "flow.comment"
  | "flow.inbound"
  | "flow.public_reply"
  | "flow.opening"
  | "flow.not_following"
  | "flow.delivery_text"
  | "flow.delivery_card";

export type FlowContext = {
  messenger: Messenger;
  dryRun: boolean;
  /** Queue follow-up work. Real: DB job with delay; dry run: in-memory, no waiting. */
  schedule: (type: JobType, payload: Record<string, unknown>, opts: { delayMs?: number; key: string }) => Promise<void>;
  random?: () => number;
};

// ── Timeline ────────────────────────────────────────────────────────────────

export async function recordEvent(
  runId: string,
  kind: string,
  message: string,
  opts: { level?: "info" | "warn" | "error"; data?: unknown } = {},
) {
  await prisma.flowRunEvent.create({
    data: {
      runId,
      kind,
      message,
      level: opts.level ?? "info",
      data: opts.data === undefined ? undefined : (JSON.parse(JSON.stringify(opts.data)) as Prisma.InputJsonValue),
    },
  });
}

/** API request as shown in the timeline (never contains the token). */
function req(ctx: FlowContext, method: string, path: string, body?: unknown) {
  return { request: { method, path, body }, ...(ctx.dryRun ? { dryRun: "No API call made (simulation)." } : {}) };
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function upsertContact(c: {
  igsid: string;
  username?: string | null;
  name?: string | null;
  followsMe?: boolean | null;
  isTest: boolean;
}) {
  const now = new Date();
  const known = {
    ...(c.username ? { username: c.username } : {}),
    ...(c.name ? { name: c.name } : {}),
    ...(c.followsMe !== undefined && c.followsMe !== null ? { followsMe: c.followsMe, followCheckedAt: now } : {}),
  };
  return prisma.contact.upsert({
    where: { igsid: c.igsid },
    create: { igsid: c.igsid, isTest: c.isTest, lastSeenAt: now, ...known },
    update: { lastSeenAt: now, ...known },
  });
}

async function loadRun(runId: string) {
  return prisma.flowRun.findUnique({ where: { id: runId }, include: { automation: true, contact: true } });
}
type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

async function failRun(runId: string, error: string) {
  const { count } = await prisma.flowRun.updateMany({
    where: { id: runId, status: "ACTIVE" },
    data: { status: "FAILED", error },
  });
  if (count) await recordEvent(runId, "failed", error, { level: "error" });
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";

// ── 1. Comment received ─────────────────────────────────────────────────────

export type IncomingComment = {
  commentId: string;
  text: string;
  mediaId: string | null;
  fromId: string;
  fromUsername: string | null;
  commentedAt: Date;
  /** Dry run: only consider this automation (even if paused). */
  onlyAutomationId?: string;
};

export type CommentResult =
  | { matched: false; reason: string }
  | { matched: true; runId: string; automationId: string; duplicate: boolean };

export async function handleComment(ctx: FlowContext, c: IncomingComment): Promise<CommentResult> {
  const automations = c.onlyAutomationId
    ? (await prisma.automation.findMany({ where: { id: c.onlyAutomationId } })).map((a) => ({ ...a, active: true }))
    : await prisma.automation.findMany({ where: { active: true } });

  const match = pickAutomation({ text: c.text, mediaId: c.mediaId }, automations);
  if (!match) {
    return { matched: false, reason: automations.length ? "No active automation matched this post and comment." : "No active automations." };
  }
  const a = match.automation;
  const contact = await upsertContact({ igsid: c.fromId, username: c.fromUsername, isTest: ctx.dryRun });

  let runId: string;
  try {
    const run = await prisma.flowRun.create({
      data: {
        automationId: a.id,
        contactId: contact.id,
        commentId: c.commentId,
        commentText: c.text,
        mediaId: c.mediaId,
        commentedAt: c.commentedAt,
        matchedKeyword: match.keyword,
        dryRun: ctx.dryRun,
      },
    });
    runId = run.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // One run per person per automation.
    const existing = await prisma.flowRun.findUnique({ where: { automationId_contactId: { automationId: a.id, contactId: contact.id } } });
    if (existing) {
      await recordEvent(existing.id, "duplicate_comment", `Another comment from @${c.fromUsername ?? c.fromId} ignored: one run per person per automation.`, {
        data: { commentId: c.commentId, text: c.text },
      });
      return { matched: true, runId: existing.id, automationId: a.id, duplicate: true };
    }
    throw err;
  }

  await recordEvent(
    runId,
    "matched",
    `Comment “${c.text.slice(0, 120)}” by @${c.fromUsername ?? c.fromId} matched “${a.name}”${match.keyword ? ` (keyword “${match.keyword}”)` : " (any comment)"}.`,
    { data: { commentId: c.commentId, mediaId: c.mediaId, keyword: match.keyword } },
  );

  if (a.publicReplyEnabled) {
    const text = pickPublicReply(a, contact, ctx.random);
    if (text) {
      await prisma.flowRun.update({ where: { id: runId }, data: { publicReplyText: text } });
      await ctx.schedule("flow.public_reply", { runId }, { delayMs: humanDelayMs(ctx.random), key: `public_reply:${runId}` });
    }
  }
  await ctx.schedule("flow.opening", { runId }, { delayMs: humanDelayMs(ctx.random), key: `opening:${runId}` });
  return { matched: true, runId, automationId: a.id, duplicate: false };
}

// ── Public comment reply ────────────────────────────────────────────────────

export async function sendPublicReply(ctx: FlowContext, runId: string) {
  const run = await loadRun(runId);
  if (!run || run.publicRepliedAt || !run.publicReplyText) return;
  const res = await ctx.messenger.replyToComment(run.commentId, run.publicReplyText);
  await prisma.flowRun.update({ where: { id: runId }, data: { publicRepliedAt: new Date() } });
  await recordEvent(runId, "public_reply_sent", `Replied publicly: “${run.publicReplyText}”`, {
    data: { ...req(ctx, "POST", `/${run.commentId}/replies`, { message: run.publicReplyText }), response: res },
  });
}

// ── Opening DM (private reply) ──────────────────────────────────────────────

export async function sendOpening(ctx: FlowContext, runId: string) {
  const run = await loadRun(runId);
  if (!run || run.status !== "ACTIVE" || run.currentStep !== "TRIGGERED") return;

  if (privateReplyExpired(run.commentedAt)) {
    await failRun(runId, "Comment is older than 7 days; Instagram no longer allows a private reply.");
    return;
  }

  const recipient: MessageRecipient = { comment_id: run.commentId };
  let message: OutgoingMessage = openingMessage(run.automation, run.contact, runId);
  let res;
  try {
    res = await ctx.messenger.sendMessage(recipient, message);
  } catch (err) {
    // Meta doesn't document quick replies in private replies. If it rejects the button
    // (invalid parameter), nothing was sent, so send the text alone; any text reply then counts as opt-in.
    if (err instanceof InstagramApiError && err.code === 100 && "quick_replies" in message) {
      await recordEvent(runId, "quick_reply_rejected", "Instagram rejected the quick-reply button on the private reply; sending text only. Any reply from the person will count as opting in.", {
        level: "warn",
        data: { error: err.info },
      });
      message = { text: message.text };
      res = await ctx.messenger.sendMessage(recipient, message);
    } else {
      throw err;
    }
  }

  await prisma.flowRun.updateMany({
    where: { id: runId, currentStep: "TRIGGERED" },
    data: { currentStep: "AWAITING_OPT_IN", openingSentAt: new Date() },
  });
  await recordEvent(runId, "opening_sent", "Sent the opening DM as a private reply. Waiting for the button tap.", {
    data: { ...req(ctx, "POST", `/{ig-account-id}/messages`, { recipient, message }), response: res },
  });
}

// ── 2/3. Inbound message: quick-reply tap or text reply ─────────────────────

export type IncomingMessage = {
  senderId: string;
  text: string | null;
  /** Quick-reply or postback payload. */
  payload: string | null;
  mid?: string | null;
};

export async function handleInbound(ctx: FlowContext, m: IncomingMessage): Promise<{ runId: string | null; outcome: string }> {
  const sender = await upsertContact({ igsid: m.senderId, isTest: ctx.dryRun });
  const decoded = decodePayload(m.payload);

  let run: LoadedRun | null;
  let tap: Tap | null;
  if (decoded) {
    run = await loadRun(decoded.runId);
    if (!run || run.dryRun !== ctx.dryRun) return { runId: null, outcome: "Payload refers to an unknown run." };
    tap = decoded.tap;
    if (run.contactId !== sender.id) run = await linkMessagingId(run, sender.id, m.senderId);
  } else {
    // Text reply (e.g. desktop, where quick replies aren't shown): continue the person's waiting run.
    run = await prisma.flowRun.findFirst({
      where: { contactId: sender.id, status: "ACTIVE", dryRun: ctx.dryRun, currentStep: { in: ["AWAITING_OPT_IN", "AWAITING_FOLLOW"] } },
      orderBy: { updatedAt: "desc" },
      include: { automation: true, contact: true },
    });
    if (!run) return { runId: null, outcome: "No run waiting for this person." };
    tap = tapForStep(run.currentStep);
  }
  if (!tap) return { runId: run.id, outcome: "Nothing to do." };

  const a = run.automation;
  const snapshot = {
    step: run.currentStep,
    status: run.status,
    followChecks: run.followChecks,
    followGateEnabled: a.followGateEnabled,
    maxFollowChecks: a.maxFollowChecks,
  };
  const how = decoded ? "Tapped" : "Replied instead of tapping";
  const label = tap === "OPT_IN" ? `“${a.openingButton}”` : `“${a.notFollowingButton ?? "I've followed"}”`;

  // Stale/duplicate taps are ignored before any API call.
  const precheck = transition(snapshot, tap, a.followGateEnabled ? false : null);
  if (precheck.kind === "ignore") {
    await recordEvent(run.id, "ignored", `${how} ${label}: ${precheck.reason}`, { level: "warn" });
    return { runId: run.id, outcome: precheck.reason };
  }

  // The tap counts as a message, so we may read the profile now (name, username, follow status).
  let follows: boolean | null = null;
  if (needsFollowCheck(snapshot, tap)) {
    const profile = await ctx.messenger.getFollowProfile(run.contact.igsid);
    follows = profile.followsBusiness === true;
    await upsertContact({ igsid: run.contact.igsid, username: profile.username, name: profile.name, followsMe: follows, isTest: ctx.dryRun });
    await recordEvent(run.id, "follow_checked", `${how} ${label}. Follow check: @${profile.username ?? run.contact.username ?? "?"} ${follows ? "follows you ✅" : "does not follow you"}.`, {
      data: { ...req(ctx, "GET", `/${run.contact.igsid}`, { fields: "name,username,is_user_follow_business" }), response: profile },
    });
  } else {
    // Gate off: profile is only for {first_name}; failures don't block delivery.
    try {
      const profile = await ctx.messenger.getFollowProfile(run.contact.igsid);
      await upsertContact({ igsid: run.contact.igsid, username: profile.username, name: profile.name, followsMe: profile.followsBusiness ?? null, isTest: ctx.dryRun });
    } catch (err) {
      await recordEvent(run.id, "profile_unavailable", `Couldn't read the profile (${describeError(err)}); using “there” for {first_name}.`, { level: "warn" });
    }
    await recordEvent(run.id, "opted_in", `${how} ${label}.`);
  }

  const t = transition(snapshot, tap, follows);
  if (t.kind === "ignore") {
    await recordEvent(run.id, "ignored", t.reason, { level: "warn" });
    return { runId: run.id, outcome: t.reason };
  }

  // Compare-and-set: two quick taps can't both advance the run.
  const now = new Date();
  const { count } = await prisma.flowRun.updateMany({
    where: { id: run.id, status: "ACTIVE", currentStep: t.expect.step, followChecks: t.expect.followChecks },
    data: {
      currentStep: t.next.step,
      status: t.next.status,
      followChecks: t.next.followChecks,
      ...(t.optedIn && !run.optedInAt ? { optedInAt: now } : {}),
      ...(t.firstGate ? { followGatedAt: now } : {}),
      ...(t.next.status === "ABANDONED" ? { error: t.summary } : {}),
    },
  });
  if (!count) {
    await recordEvent(run.id, "ignored", "Another tap was handled at the same moment; ignoring this one.", { level: "warn" });
    return { runId: run.id, outcome: "Concurrent tap ignored." };
  }

  await recordEvent(run.id, t.next.status === "ABANDONED" ? "abandoned" : "transition", t.summary, {
    level: t.next.status === "ABANDONED" ? "warn" : "info",
    data: { from: t.expect, to: t.next },
  });

  for (const action of t.actions) {
    if (action === "SEND_DELIVERY") {
      await ctx.schedule("flow.delivery_text", { runId: run.id }, { delayMs: humanDelayMs(ctx.random), key: `delivery_text:${run.id}` });
    } else {
      await ctx.schedule(
        "flow.not_following",
        { runId: run.id, check: t.next.followChecks },
        { delayMs: humanDelayMs(ctx.random), key: `not_following:${run.id}:${t.next.followChecks}` },
      );
    }
  }
  return { runId: run.id, outcome: t.summary };
}

/**
 * The commenter's ID (from the comment webhook) and their messaging IGSID (from the tap) should
 * match; if Meta ever reports different IDs, attach the run to the messaging identity.
 */
async function linkMessagingId(run: LoadedRun, senderContactId: string, senderIgsid: string): Promise<LoadedRun> {
  try {
    await prisma.flowRun.update({ where: { id: run.id }, data: { contactId: senderContactId } });
    if (run.contact.username) {
      await prisma.contact.updateMany({ where: { id: senderContactId, username: null }, data: { username: run.contact.username } });
    }
    await recordEvent(run.id, "contact_linked", `Messaging ID ${senderIgsid} differs from the commenter ID ${run.contact.igsid}; linked the run to the messaging ID.`, { level: "warn" });
    return (await loadRun(run.id))!;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await recordEvent(run.id, "contact_link_skipped", `Tap came from ${senderIgsid}, which already has its own run for this automation; continuing with the original contact.`, { level: "warn" });
    return run;
  }
}

// ── Messages after opt-in ───────────────────────────────────────────────────

export async function sendNotFollowing(ctx: FlowContext, runId: string, check: number) {
  const run = await loadRun(runId);
  // Stale if the run moved on (or another check happened) since this was scheduled.
  if (!run || run.status !== "ACTIVE" || run.currentStep !== "AWAITING_FOLLOW" || run.followChecks !== check) return;
  const recipient = { id: run.contact.igsid };
  const message = notFollowingMessage(run.automation, run.contact, runId);
  const res = await ctx.messenger.sendMessage(recipient, message);
  await recordEvent(runId, "not_following_sent", "Sent the follow-gate message. Waiting for “I've followed”.", {
    data: { ...req(ctx, "POST", `/{ig-account-id}/messages`, { recipient, message }), response: res },
  });
}

export async function sendDeliveryText(ctx: FlowContext, runId: string) {
  const run = await loadRun(runId);
  if (!run || run.status !== "ACTIVE" || run.currentStep !== "DELIVERING") return;
  const recipient = { id: run.contact.igsid };
  const message = deliveryText(run.automation, run.contact);
  const res = await ctx.messenger.sendMessage(recipient, message);
  await recordEvent(runId, "delivery_text_sent", "Sent the delivery message.", {
    data: { ...req(ctx, "POST", `/{ig-account-id}/messages`, { recipient, message }), response: res },
  });
  // Separate job, so a failed card is retried without resending the text.
  await ctx.schedule("flow.delivery_card", { runId }, { delayMs: 800 + Math.floor((ctx.random ?? Math.random)() * 1200), key: `delivery_card:${runId}` });
}

export async function sendDeliveryCard(ctx: FlowContext, runId: string) {
  const run = await loadRun(runId);
  if (!run || run.status !== "ACTIVE" || run.currentStep !== "DELIVERING") return;
  const recipient = { id: run.contact.igsid };
  const message = deliveryCard(run.automation, run.contact);
  const res = await ctx.messenger.sendMessage(recipient, message);
  await prisma.flowRun.updateMany({
    where: { id: runId, currentStep: "DELIVERING" },
    data: { currentStep: "DELIVERED", status: "COMPLETED", completedAt: new Date() },
  });
  await recordEvent(runId, "completed", `Link delivered: ${run.automation.deliveryUrl}`, {
    data: { ...req(ctx, "POST", `/{ig-account-id}/messages`, { recipient, message }), response: res },
  });
}

// ── Job failure hook ────────────────────────────────────────────────────────

/** Called when a job gives up (permanent error or out of retries). */
export async function onJobGaveUp(type: JobType, payload: Record<string, unknown>, err: unknown) {
  const message = describeError(err);
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (runId) {
    if (type === "flow.public_reply") {
      // The public reply is optional: record it, keep the run going.
      await recordEvent(runId, "public_reply_failed", `Public reply failed: ${message}`, { level: "error" });
    } else {
      await failRun(runId, `${stepLabel(type)} failed: ${message}`);
    }
  }
  const eventId = typeof payload.eventId === "string" ? payload.eventId : null;
  if (eventId) await prisma.webhookEvent.update({ where: { id: eventId }, data: { error: message } }).catch(() => {});
}

export function stepLabel(type: JobType): string {
  return (
    {
      "flow.comment": "Handling the comment",
      "flow.inbound": "Handling the reply",
      "flow.public_reply": "Public reply",
      "flow.opening": "Opening DM",
      "flow.not_following": "Follow-gate message",
      "flow.delivery_text": "Delivery message",
      "flow.delivery_card": "Link card",
    } as const
  )[type];
}
