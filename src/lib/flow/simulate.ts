import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { getOwnAccount } from "../instagram-account";
import { dispatch } from "./jobs";
import { handleComment, handleInbound, type FlowContext, type JobType } from "./engine";
import { encodePayload, tapForStep } from "./machine";
import { DryRunMessenger, type DryRunCall } from "./messenger";

export type SimulationInput = {
  comment: string;
  username: string;
  name: string;
  /** null = never follows; 0 = already follows; n = follows after n “not following” checks. */
  followsAfterChecks: number | null;
};

export type SimulationResult = {
  matched: boolean;
  reason?: string;
  runId?: string;
  status?: string;
  step?: string;
  calls: DryRunCall[];
  timeline: { at: string; kind: string; level: string; message: string; data: unknown }[];
};

/**
 * Dry run: the real engine handlers with a fake Messenger (no network) and an in-memory queue
 * (no delays). Then plays the commenter: taps the opening button, and keeps tapping
 * “I've followed” while the run waits. Rows are flagged dryRun/isTest and excluded from stats.
 */
export async function simulateComment(automationId: string, input: SimulationInput): Promise<SimulationResult> {
  const automation = await prisma.automation.findUnique({ where: { id: automationId } });
  if (!automation) throw new Error("Automation not found.");
  const own = await getOwnAccount();

  const suffix = randomUUID().slice(0, 8);
  const igsid = `dryrun-${suffix}`;
  const messenger = new DryRunMessenger(own?.igAccountId ?? "{ig-account-id}", {
    name: input.name,
    username: input.username,
    followsAfterChecks: input.followsAfterChecks,
  });

  const queue: { type: JobType; payload: Record<string, unknown> }[] = [];
  const queued = new Set<string>();
  const ctx: FlowContext = {
    messenger,
    dryRun: true,
    schedule: async (type, payload, { key }) => {
      if (queued.has(key)) return; // same idempotency as the real queue
      queued.add(key);
      queue.push({ type, payload });
    },
  };
  const drain = async () => {
    while (queue.length) {
      const job = queue.shift()!;
      await dispatch(ctx, job.type, job.payload);
    }
  };

  const result = await handleComment(ctx, {
    commentId: `dryrun-comment-${suffix}`,
    text: input.comment,
    mediaId: automation.mediaScope === "SPECIFIC" ? automation.mediaId : `dryrun-media-${suffix}`,
    fromId: igsid,
    fromUsername: input.username,
    commentedAt: new Date(),
    onlyAutomationId: automationId,
  });
  if (!result.matched) {
    return { matched: false, reason: `“${input.comment}” doesn't match this automation's keywords.`, calls: messenger.calls, timeline: [] };
  }
  await drain();

  // Play the user: tap whatever button the run is waiting for, until it finishes.
  for (let i = 0; i < 25; i++) {
    const run = await prisma.flowRun.findUnique({ where: { id: result.runId } });
    if (!run || run.status !== "ACTIVE") break;
    const tap = tapForStep(run.currentStep);
    if (!tap) break;
    await handleInbound(ctx, { senderId: igsid, text: null, payload: encodePayload(run.id, tap) });
    await drain();
  }

  const run = await prisma.flowRun.findUnique({
    where: { id: result.runId },
    include: { events: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
  });
  return {
    matched: true,
    runId: result.runId,
    status: run?.status,
    step: run?.currentStep,
    calls: messenger.calls,
    timeline: (run?.events ?? []).map((e) => ({ at: e.at.toISOString(), kind: e.kind, level: e.level, message: e.message, data: e.data })),
  };
}
