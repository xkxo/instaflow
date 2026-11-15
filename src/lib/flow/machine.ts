/**
 * Flow state machine and pure helpers for the automation engine. No I/O: everything here is
 * deterministic (given its inputs) and unit-tested.
 *
 *   comment ──match──▶ TRIGGERED ──opening DM (private reply)──▶ AWAITING_OPT_IN
 *   AWAITING_OPT_IN ──tap──▶ gate off / follows ──▶ DELIVERING ──text + card──▶ DELIVERED (COMPLETED)
 *                          └ not following ──▶ AWAITING_FOLLOW (+ "not following" message)
 *   AWAITING_FOLLOW ──"I've followed"──▶ follows ──▶ DELIVERING
 *                                     └ not following ──▶ resend gate, or ABANDONED after max re-checks
 */
import {
  matchKeyword,
  renderTemplate,
  type AutomationInput,
} from "../automations/schema";
import type { OutgoingMessage, QuickReply } from "../instagram";

// ── Types (mirror the Prisma enums, kept local so this file stays pure) ─────

export type FlowStep = "TRIGGERED" | "AWAITING_OPT_IN" | "AWAITING_FOLLOW" | "DELIVERING" | "DELIVERED";
export type FlowStatus = "ACTIVE" | "COMPLETED" | "ABANDONED" | "FAILED";

// ── Automation matching ─────────────────────────────────────────────────────

export type MatchableAutomation = Pick<
  AutomationInput,
  "mediaScope" | "keywordMode" | "keywords" | "keywordMatch" | "active"
> & { id: string; mediaId: string | null; updatedAt: Date };

export type CommentForMatch = { text: string; mediaId: string | null };

/**
 * Pick the ONE automation that handles a comment (a comment can only get one private reply).
 * Priority: active only → post matches → keyword matches; then specific-post automations beat
 * "any post", keyword automations beat "any comment", most recently edited wins ties.
 */
export function pickAutomation<A extends MatchableAutomation>(
  comment: CommentForMatch,
  automations: A[],
): { automation: A; keyword: string | null } | null {
  const candidates: { automation: A; keyword: string | null; score: number }[] = [];
  for (const a of automations) {
    if (!a.active) continue;
    if (a.mediaScope === "SPECIFIC" && (!a.mediaId || a.mediaId !== comment.mediaId)) continue;
    let keyword: string | null = null;
    if (a.keywordMode === "KEYWORDS") {
      keyword = matchKeyword(comment.text, a.keywords, a.keywordMatch);
      if (!keyword) continue;
    }
    const score = (a.mediaScope === "SPECIFIC" ? 2 : 0) + (a.keywordMode === "KEYWORDS" ? 1 : 0);
    candidates.push({ automation: a, keyword, score });
  }
  candidates.sort((x, y) => y.score - x.score || y.automation.updatedAt.getTime() - x.automation.updatedAt.getTime());
  return candidates[0] ? { automation: candidates[0].automation, keyword: candidates[0].keyword } : null;
}

// ── Quick-reply payloads: "IF1:<runId>:<tap>" ───────────────────────────────

export type Tap = "OPT_IN" | "FOLLOWED";
const PAYLOAD_PREFIX = "IF1";

export function encodePayload(runId: string, tap: Tap): string {
  return `${PAYLOAD_PREFIX}:${runId}:${tap}`;
}

export function decodePayload(payload: string | null | undefined): { runId: string; tap: Tap } | null {
  if (!payload) return null;
  const [prefix, runId, tap, ...rest] = payload.split(":");
  if (prefix !== PAYLOAD_PREFIX || !runId || rest.length || (tap !== "OPT_IN" && tap !== "FOLLOWED")) return null;
  if (!/^[a-z0-9_-]{8,64}$/i.test(runId)) return null;
  return { runId, tap };
}

/** A plain text reply (no button tap, e.g. on desktop where quick replies don't show) counts as the tap the run is waiting for. */
export function tapForStep(step: FlowStep): Tap | null {
  if (step === "AWAITING_OPT_IN") return "OPT_IN";
  if (step === "AWAITING_FOLLOW") return "FOLLOWED";
  return null;
}

// ── Transitions ─────────────────────────────────────────────────────────────

export type RunSnapshot = {
  step: FlowStep;
  status: FlowStatus;
  followChecks: number;
  followGateEnabled: boolean;
  maxFollowChecks: number;
};

export type Action = "SEND_DELIVERY" | "SEND_NOT_FOLLOWING";

export type Transition =
  | { kind: "ignore"; reason: string }
  | {
      kind: "advance";
      /** Compare-and-set guard: only apply if the run is still in exactly this state. */
      expect: { step: FlowStep; followChecks: number };
      next: { step: FlowStep; status: FlowStatus; followChecks: number };
      optedIn: boolean;
      firstGate: boolean;
      actions: Action[];
      summary: string;
    };

/** Does handling this tap require a follow check first? */
export function needsFollowCheck(run: RunSnapshot, tap: Tap): boolean {
  return run.status === "ACTIVE" && run.followGateEnabled && tapForStep(run.step) === tap;
}

/**
 * Next state after a tap. `follows` is the result of the follow check (required when
 * needsFollowCheck() is true, ignored otherwise).
 */
export function transition(run: RunSnapshot, tap: Tap, follows: boolean | null): Transition {
  if (run.status !== "ACTIVE") return { kind: "ignore", reason: `Run is already ${run.status.toLowerCase()}.` };
  const expected = tapForStep(run.step);
  if (expected !== tap) {
    return {
      kind: "ignore",
      reason:
        expected === null
          ? `Nothing to do at step ${run.step} (duplicate or stale tap).`
          : `Expected ${expected === "OPT_IN" ? "the opening button" : "“I've followed”"}, got a stale ${tap === "OPT_IN" ? "opening" : "“I've followed”"} tap.`,
    };
  }
  const expect = { step: run.step, followChecks: run.followChecks };
  const optedIn = tap === "OPT_IN";

  const deliver = (summary: string): Transition => ({
    kind: "advance",
    expect,
    next: { step: "DELIVERING", status: "ACTIVE", followChecks: run.followChecks },
    optedIn,
    firstGate: false,
    actions: ["SEND_DELIVERY"],
    summary,
  });

  if (!run.followGateEnabled) return deliver("Follow gate off → delivering link.");
  if (follows === null) throw new Error("Follow status is required when the follow gate is on.");
  if (follows) return deliver(optedIn ? "Already following → delivering link." : "Now following → delivering link.");

  const checks = run.followChecks + 1;
  const recheck = checks - 1; // the first check (on opt-in) isn't a re-check
  if (!optedIn && recheck >= run.maxFollowChecks) {
    return {
      kind: "advance",
      expect,
      next: { step: run.step, status: "ABANDONED", followChecks: checks },
      optedIn,
      firstGate: false,
      actions: [],
      summary: `Still not following after ${run.maxFollowChecks} re-check${run.maxFollowChecks === 1 ? "" : "s"} → abandoned.`,
    };
  }
  return {
    kind: "advance",
    expect,
    next: { step: "AWAITING_FOLLOW", status: "ACTIVE", followChecks: checks },
    optedIn,
    firstGate: run.followChecks === 0,
    actions: ["SEND_NOT_FOLLOWING"],
    summary: optedIn
      ? "Not following → sent the follow-gate message."
      : `Re-check ${recheck} of ${run.maxFollowChecks}: still not following → resent the follow-gate message.`,
  };
}

// ── Messages ────────────────────────────────────────────────────────────────

export type MessageAutomation = Pick<
  AutomationInput,
  "openingMessage" | "openingButton" | "deliveryMessage" | "deliveryCardTitle" | "deliveryUrl" | "deliveryButton" | "publicReplies"
> & {
  /** Null when the follow gate is off (DB column is optional). */
  notFollowingMessage: string | null;
  notFollowingButton: string | null;
};
export type Person = { username: string | null; name: string | null };

/** Values for {first_name} / {username}; "there" when unknown (e.g. before profile consent). */
export function templateValues(p: Person) {
  const first = p.name?.trim().split(/\s+/)[0];
  return { first_name: first || "there", username: p.username || "there" };
}

/** Quick-reply titles over 20 chars are truncated by Instagram anyway; do it ourselves, cleanly. */
export function quickReplyTitle(label: string): string {
  const chars = [...label];
  return chars.length <= 20 ? label : chars.slice(0, 19).join("") + "…";
}

function textWithButton(text: string, button: string, payload: string): OutgoingMessage {
  const qr: QuickReply = { content_type: "text", title: quickReplyTitle(button), payload };
  return { text, quick_replies: [qr] };
}

export function openingMessage(a: MessageAutomation, p: Person, runId: string): OutgoingMessage {
  const v = templateValues(p);
  return textWithButton(renderTemplate(a.openingMessage, v), renderTemplate(a.openingButton, v), encodePayload(runId, "OPT_IN"));
}

export function notFollowingMessage(a: MessageAutomation, p: Person, runId: string): OutgoingMessage {
  const v = templateValues(p);
  return textWithButton(
    renderTemplate(a.notFollowingMessage ?? "Please follow this account, then tap the button below.", v),
    renderTemplate(a.notFollowingButton || "I've followed", v),
    encodePayload(runId, "FOLLOWED"),
  );
}

export function deliveryText(a: MessageAutomation, p: Person): OutgoingMessage {
  return { text: renderTemplate(a.deliveryMessage, templateValues(p)) };
}

/** Instagram's only template is "generic": a card with a title and up to 3 buttons. */
export function deliveryCard(a: MessageAutomation, p: Person): OutgoingMessage {
  const v = templateValues(p);
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [
          {
            title: renderTemplate(a.deliveryCardTitle, v),
            buttons: [{ type: "web_url", url: a.deliveryUrl, title: renderTemplate(a.deliveryButton || "Open link", v) }],
          },
        ],
      },
    },
  };
}

export function pickPublicReply(a: Pick<MessageAutomation, "publicReplies">, p: Person, random = Math.random): string | null {
  const options = a.publicReplies.filter((r) => r.trim());
  if (!options.length) return null;
  return renderTemplate(options[Math.floor(random() * options.length)], templateValues(p));
}

// ── Timing & retries ────────────────────────────────────────────────────────

/** Random 2–6 s pause before each DM so replies feel human. */
export function humanDelayMs(random = Math.random): number {
  return 2000 + Math.floor(random() * 4001);
}

/** Private replies must be sent within 7 days of the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function privateReplyExpired(commentedAt: Date, now = Date.now()): boolean {
  return now - commentedAt.getTime() > PRIVATE_REPLY_WINDOW_MS;
}

/** Meta rate-limit codes (4 app, 17 user, 32 page, 613 custom, 80002 Instagram BUC). */
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);

export type ErrorInfo = { httpStatus: number; code?: number };

/** Retry network errors, 5xx, rate limits and Meta's "temporary" codes 1/2. Everything else is permanent. */
export function isRetryable(e: ErrorInfo): boolean {
  return e.httpStatus === 0 || e.httpStatus >= 500 || (e.code !== undefined && (RATE_LIMIT_CODES.has(e.code) || e.code === 1 || e.code === 2));
}

/**
 * Exponential backoff with jitter. `attempt` is the attempt that just failed (1-based).
 * Rate limits back off from 60 s (Meta's windows are long); other errors from 15 s. Capped at 1 h.
 */
export function backoffMs(attempt: number, e: ErrorInfo, random = Math.random): number {
  const base = e.code !== undefined && RATE_LIMIT_CODES.has(e.code) ? 60_000 : 15_000;
  const raw = base * 2 ** Math.max(0, attempt - 1);
  const jittered = raw * (0.8 + random() * 0.4);
  return Math.min(Math.round(jittered), 60 * 60 * 1000);
}
