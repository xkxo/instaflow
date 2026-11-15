import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { describeError, InstagramApiError } from "../instagram";
import { getAccessToken } from "../instagram-account";
import {
  handleComment,
  handleInbound,
  onJobGaveUp,
  recordEvent,
  sendDeliveryCard,
  sendDeliveryText,
  sendNotFollowing,
  sendOpening,
  sendPublicReply,
  stepLabel,
  type FlowContext,
  type JobType,
} from "./engine";
import { backoffMs, isRetryable } from "./machine";
import { GraphMessenger } from "./messenger";

const STALE_LOCK_MS = 5 * 60 * 1000;

// ── Enqueue ─────────────────────────────────────────────────────────────────

/** Add a job. Idempotent per `key`: enqueuing the same key twice is a no-op. */
export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { delayMs?: number; key: string }) {
  await prisma.job.createMany({
    data: [
      {
        type,
        payload: payload as Prisma.InputJsonValue,
        key: opts.key,
        runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
      },
    ],
    skipDuplicates: true,
  });
}

// ── Worker ──────────────────────────────────────────────────────────────────

type ClaimedJob = { id: string; type: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number };

/** Atomically claim due jobs (and jobs whose worker died). SKIP LOCKED → parallel workers never collide. */
async function claim(limit: number): Promise<ClaimedJob[]> {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING' AND "runAt" <= now())
         OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"`;
}

let cachedCtx: { ctx: FlowContext; at: number } | null = null;

/** Real context: Graph messenger with the stored system-user token. Cached briefly per worker. */
async function realContext(): Promise<FlowContext> {
  if (cachedCtx && Date.now() - cachedCtx.at < 60_000) return cachedCtx.ctx;
  const token = await getAccessToken();
  if (!token) throw new Error("No Instagram account connected.");
  const ctx: FlowContext = {
    messenger: new GraphMessenger(token.accessToken, token.igAccountId),
    dryRun: false,
    schedule: (type, payload, opts) => enqueue(type, payload, opts),
  };
  cachedCtx = { ctx, at: Date.now() };
  return ctx;
}

/** Map a stored webhook event to engine input. */
async function loadWebhookEvent(eventId: string) {
  const ev = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!ev) throw new Error(`Webhook event ${eventId} not found.`);
  return ev;
}

export async function dispatch(ctx: FlowContext, type: JobType, payload: Record<string, unknown>) {
  const runId = String(payload.runId ?? "");
  switch (type) {
    case "flow.comment": {
      const ev = await loadWebhookEvent(String(payload.eventId));
      const value = ((ev.payload as { value?: Record<string, unknown> }).value ?? {}) as {
        id?: string;
        text?: string;
        media?: { id?: string };
        from?: { id?: string; username?: string };
      };
      if (!value.id || !value.from?.id) throw new Error("Comment webhook is missing the comment ID or commenter ID.");
      await handleComment(ctx, {
        commentId: String(value.id),
        text: value.text ?? "",
        mediaId: value.media?.id ? String(value.media.id) : null,
        fromId: String(value.from.id),
        fromUsername: value.from.username ?? null,
        commentedAt: ev.receivedAt,
      });
      return;
    }
    case "flow.inbound": {
      const ev = await loadWebhookEvent(String(payload.eventId));
      if (!ev.senderId) throw new Error("Message webhook has no sender.");
      await handleInbound(ctx, { senderId: ev.senderId, text: ev.text, payload: ev.actionPayload });
      return;
    }
    case "flow.public_reply":
      return sendPublicReply(ctx, runId);
    case "flow.opening":
      return sendOpening(ctx, runId);
    case "flow.not_following":
      return sendNotFollowing(ctx, runId, Number(payload.check));
    case "flow.delivery_text":
      return sendDeliveryText(ctx, runId);
    case "flow.delivery_card":
      return sendDeliveryCard(ctx, runId);
    default:
      throw new Error(`Unknown job type ${type as string}`);
  }
}

async function runJob(job: ClaimedJob) {
  const type = job.type as JobType;
  const runId = typeof job.payload.runId === "string" ? job.payload.runId : null;
  try {
    await dispatch(await realContext(), type, job.payload);
    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null, lastError: null } });
  } catch (err) {
    const info = err instanceof InstagramApiError ? err.info : { httpStatus: 0 };
    const retryable = err instanceof InstagramApiError && isRetryable(info);
    const message = describeError(err);

    if (retryable && job.attempts < job.maxAttempts) {
      const delay = backoffMs(job.attempts, info);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "PENDING", runAt: new Date(Date.now() + delay), lockedAt: null, lastError: message },
      });
      if (runId) {
        await recordEvent(runId, "api_error", `${stepLabel(type)}: ${message}. Retrying in ${Math.round(delay / 1000)}s (attempt ${job.attempts} of ${job.maxAttempts}).`, {
          level: "warn",
          data: { error: err instanceof InstagramApiError ? err.info : message, retryInMs: delay },
        });
      }
      return;
    }

    await prisma.job.update({ where: { id: job.id }, data: { status: "FAILED", lockedAt: null, lastError: message } });
    if (runId && err instanceof InstagramApiError) {
      await recordEvent(runId, "api_error", `${stepLabel(type)}: ${message}${retryable ? " (out of retries)" : " (not retryable)"}.`, {
        level: "error",
        data: { error: err.info },
      });
    }
    console.error(`[jobs] ${type} ${job.id} failed after ${job.attempts} attempt(s): ${message}`);
    await onJobGaveUp(type, job.payload, err);
  }
}

let draining: Promise<{ processed: number }> | null = null;

/**
 * Run due jobs until `maxMs` elapses or nothing is due soon. Waits for jobs that become due
 * within the window (the 2–6 s human delays), so a webhook's whole first step completes in
 * one invocation. One drain at a time per process.
 */
export function drainJobs({ maxMs = 25_000, batch = 5 }: { maxMs?: number; batch?: number } = {}) {
  if (draining) return draining;
  draining = (async () => {
    const deadline = Date.now() + maxMs;
    let processed = 0;
    try {
      while (Date.now() < deadline) {
        const jobs = await claim(batch);
        if (jobs.length) {
          for (const job of jobs) await runJob(job);
          processed += jobs.length;
          continue;
        }
        const next = await prisma.job.findFirst({ where: { status: "PENDING" }, orderBy: { runAt: "asc" }, select: { runAt: true } });
        if (!next) break;
        const wait = next.runAt.getTime() - Date.now();
        if (wait > deadline - Date.now()) break; // due after this window: the poller/cron will pick it up
        await new Promise((r) => setTimeout(r, Math.max(50, wait)));
      }
    } finally {
      draining = null;
    }
    return { processed };
  })();
  return draining;
}

/** Housekeeping: drop finished jobs older than 7 days. */
export async function pruneJobs() {
  const { count } = await prisma.job.deleteMany({
    where: { status: { in: ["DONE", "FAILED"] }, updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
  });
  return count;
}

export async function jobQueueStats() {
  const rows = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<"PENDING" | "RUNNING" | "DONE" | "FAILED", number>>;
}
