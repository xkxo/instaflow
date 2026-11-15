import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { describeError, getMessagingUserProfile } from "../instagram";
import { getAccessToken, getOwnAccount } from "../instagram-account";
import { enqueue } from "../flow/jobs";
import { extractEvents, type ParsedEvent } from "./parse";

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

// ── Ingest ──────────────────────────────────────────────────────────────────

export type IngestResult = { received: number; inserted: number; duplicates: number; ignored: number };

/** Insert one event; on a duplicate key just bump deliveryCount. Returns true if newly inserted. */
async function insertEvent(e: ParsedEvent): Promise<boolean> {
  const ignored = e.ignoredReason !== null;
  const rows = await prisma.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO "WebhookEvent"
      ("id", "idempotencyKey", "type", "igAccountId", "senderId", "senderUsername", "text", "actionPayload",
       "payload", "processed", "processedAt", "ignoredReason")
    VALUES
      (${randomUUID()}, ${e.key}, ${e.type}, ${e.igAccountId}, ${e.senderId}, ${e.senderUsername}, ${e.text},
       ${e.actionPayload}, ${JSON.stringify(e.payload)}::jsonb, ${ignored}, ${ignored ? new Date() : null},
       ${e.ignoredReason})
    ON CONFLICT ("idempotencyKey")
      DO UPDATE SET "deliveryCount" = "WebhookEvent"."deliveryCount" + 1
    RETURNING (xmax = 0) AS inserted`;
  return rows[0]?.inserted === true;
}

/**
 * Persist every event in a verified webhook body (dedup by idempotency key).
 * Runs BEFORE we answer Meta, so if the DB is down we return 5xx and Meta retries.
 */
export async function ingestWebhook(body: unknown): Promise<IngestResult> {
  const events = extractEvents(body, await getOwnAccount());
  const result: IngestResult = { received: events.length, inserted: 0, duplicates: 0, ignored: 0 };
  for (const e of events) {
    if (await insertEvent(e)) {
      result.inserted++;
      if (e.ignoredReason) result.ignored++;
    } else {
      result.duplicates++;
    }
  }
  return result;
}

// ── Processing ──────────────────────────────────────────────────────────────

type StoredEvent = { id: string; type: string; senderId: string | null; senderUsername: string | null };

/** Fill in the username for DM senders (messaging webhooks only carry an Instagram-scoped ID). */
async function enrichSender(event: StoredEvent, token: { accessToken: string } | null) {
  if (event.senderUsername || !event.senderId || event.type === "comment") return;

  // Reuse a username we already resolved for this sender.
  const known = await prisma.webhookEvent.findFirst({
    where: { senderId: event.senderId, senderUsername: { not: null } },
    select: { senderUsername: true },
  });
  let username = known?.senderUsername ?? null;

  if (!username && token) {
    try {
      username = (await getMessagingUserProfile(token.accessToken, event.senderId)).username ?? null;
    } catch {
      // Non-fatal: the error is logged by the Graph client and the event still gets processed.
    }
  }
  if (username) await prisma.webhookEvent.update({ where: { id: event.id }, data: { senderUsername: username } });
}

/**
 * Handle one event: hand it to the flow engine via the job queue (idempotent per event), so
 * webhook handling stays fast and Meta errors get retried with backoff.
 */
async function handleEvent(event: StoredEvent, token: { accessToken: string } | null): Promise<void> {
  switch (event.type) {
    case "comment":
      await enqueue("flow.comment", { eventId: event.id }, { key: `comment:${event.id}` });
      return;
    case "message":
    case "quick_reply":
    case "postback":
      await enrichSender(event, token);
      await enqueue("flow.inbound", { eventId: event.id }, { key: `inbound:${event.id}` });
      return;
    case "live_comment":
      // Private replies to live comments only work during the broadcast; not automated.
      return;
    default:
      return;
  }
}

/**
 * Process unprocessed events (oldest first). Each event is claimed atomically first, so
 * overlapping runs never handle the same event twice; this matters once automations send replies.
 * Stale claims (crashed runs) are retried after CLAIM_TIMEOUT_MS.
 */
export async function processPendingEvents(limit = 25): Promise<{ processed: number; failed: number }> {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const pending = await prisma.webhookEvent.findMany({
    where: { processed: false, error: null },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true, type: true, senderId: true, senderUsername: true },
  });
  if (!pending.length) return { processed: 0, failed: 0 };

  const token = await getAccessToken().catch(() => null);
  let processed = 0;
  let failed = 0;

  for (const event of pending) {
    const claim = await prisma.webhookEvent.updateMany({
      where: { id: event.id, processed: false, OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }] },
      data: { processingAt: new Date() },
    });
    if (claim.count === 0) continue; // another run has it

    try {
      await handleEvent(event, token);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processed: true, processedAt: new Date(), error: null },
      });
      processed++;
    } catch (err) {
      failed++;
      const error = describeError(err);
      console.error(`[webhooks] processing ${event.type} ${event.id} failed: ${error}`);
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { error, processingAt: null } });
    }
  }
  return { processed, failed };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export type WebhookEventRow = {
  id: string;
  type: string;
  senderUsername: string | null;
  senderId: string | null;
  text: string | null;
  actionPayload: string | null;
  status: "processed" | "ignored" | "failed" | "pending";
  statusDetail: string | null;
  deliveryCount: number;
  receivedAt: string;
  payload: unknown;
};

export async function listRecentEvents(limit = 50): Promise<WebhookEventRow[]> {
  const rows = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    senderUsername: r.senderUsername,
    senderId: r.senderId,
    text: r.text,
    actionPayload: r.actionPayload,
    status: r.error ? "failed" : r.ignoredReason ? "ignored" : r.processed ? "processed" : "pending",
    statusDetail: r.error ?? r.ignoredReason,
    deliveryCount: r.deliveryCount,
    receivedAt: r.receivedAt.toISOString(),
    payload: r.payload,
  }));
}
