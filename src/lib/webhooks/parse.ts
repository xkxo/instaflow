import "server-only";
import { createHash } from "node:crypto";

/**
 * Turns a Meta webhook body (object "instagram", Unified Login format) into flat events.
 *
 *   { object: "instagram", entry: [{ id: <IG account id>, time,
 *       changes:   [{ field: "comments", value: { id, text, from: { id, username }, media, parent_id } }],
 *       messaging: [{ sender: { id }, recipient: { id }, timestamp,
 *                     message?:  { mid, text, quick_reply?: { payload }, is_echo?, attachments?, is_deleted? },
 *                     postback?: { mid, title, payload } }] }] }
 *
 * Pure function: no I/O, so it's easy to test.
 */

export type ParsedEvent = {
  /** Idempotency key: same event delivered twice → same key. */
  key: string;
  type: string;
  igAccountId: string | null;
  senderId: string | null;
  senderUsername: string | null;
  text: string | null;
  actionPayload: string | null;
  /** Non-null → store but don't process (own activity, wrong account, …). */
  ignoredReason: string | null;
  /** Raw item + envelope, stored as-is. */
  payload: Record<string, unknown>;
};

export type OwnAccount = { igAccountId: string; username: string } | null;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const hashKey = (prefix: string, data: unknown) =>
  `${prefix}:sha256:${createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 32)}`;

function ownershipReason(entryId: string | null, own: OwnAccount): string | null {
  if (!own) return "No Instagram account is connected.";
  if (entryId && entryId !== own.igAccountId) return `Event is for another Instagram account (${entryId}).`;
  return null;
}

function parseChange(field: string, value: Obj, base: Omit<ParsedEvent, "key" | "type" | "payload">, envelope: Obj, own: OwnAccount): ParsedEvent {
  const payload = { ...envelope, field, value };

  if (field === "comments" || field === "live_comments") {
    const from = isObj(value.from) ? value.from : {};
    const fromId = str(from.id);
    const fromUsername = str(from.username);
    const commentId = str(value.id);
    // Own replies to comments: match on ID or username (IDs in `from` can be scoped differently).
    const isOwn =
      !!own &&
      ((fromId !== null && (fromId === own.igAccountId || fromId === base.igAccountId)) ||
        (fromUsername !== null && fromUsername.toLowerCase() === own.username.toLowerCase()));
    return {
      ...base,
      key: commentId ? `comment:${commentId}` : hashKey("comment", payload),
      type: field === "live_comments" ? "live_comment" : "comment",
      senderId: fromId,
      senderUsername: fromUsername,
      text: str(value.text),
      ignoredReason: base.ignoredReason ?? (isOwn ? "Comment was made by your own account." : null),
      payload,
    };
  }

  return { ...base, key: hashKey(field || "change", payload), type: field || "unknown", payload };
}

function describeAttachments(message: Obj): string | null {
  if (!Array.isArray(message.attachments) || !message.attachments.length) return null;
  const types = message.attachments.map((a) => (isObj(a) ? str(a.type) : null) ?? "attachment");
  return `[${types.join(", ")}]`;
}

function parseMessaging(item: Obj, base: Omit<ParsedEvent, "key" | "type" | "payload">, envelope: Obj, own: OwnAccount): ParsedEvent {
  const payload = { ...envelope, messaging: item };
  const senderId = isObj(item.sender) ? str(item.sender.id) : null;
  const sentByUs = senderId !== null && senderId === base.igAccountId;
  // Messaging webhooks only carry IDs; we know our own username.
  const senderUsername = sentByUs && own && own.igAccountId === senderId ? own.username : null;
  const common = { ...base, senderId, senderUsername, payload };

  if (isObj(item.message)) {
    const m = item.message;
    const mid = str(m.mid);
    const quickReply = isObj(m.quick_reply) ? str(m.quick_reply.payload) : null;
    const isEcho = m.is_echo === true || sentByUs;
    return {
      ...common,
      key: mid ? `message:${mid}` : hashKey("message", payload),
      type: quickReply ? "quick_reply" : "message",
      text: str(m.text) ?? (m.is_deleted ? "[message deleted]" : m.is_unsupported ? "[unsupported message]" : describeAttachments(m)),
      actionPayload: quickReply,
      ignoredReason: base.ignoredReason ?? (isEcho ? "Echo of a message sent by your own account." : null),
    };
  }

  if (isObj(item.postback)) {
    const p = item.postback;
    const mid = str(p.mid);
    return {
      ...common,
      key: mid ? `postback:${mid}` : hashKey("postback", payload),
      type: "postback",
      text: str(p.title),
      actionPayload: str(p.payload),
      ignoredReason: base.ignoredReason ?? (sentByUs ? "Postback from your own account." : null),
    };
  }

  // reactions, reads, referrals, …: stored for visibility, not processed.
  const kind = ["reaction", "read", "referral", "optin"].find((k) => k in item) ?? "messaging";
  return { ...common, key: hashKey(kind, payload), type: kind, ignoredReason: base.ignoredReason ?? "Not a handled event type." };
}

export function extractEvents(body: unknown, own: OwnAccount): ParsedEvent[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const object = str(body.object);
  const events: ParsedEvent[] = [];

  for (const entry of body.entry) {
    if (!isObj(entry)) continue;
    const igAccountId = str(entry.id);
    const envelope = { object, entryId: igAccountId, entryTime: entry.time ?? null };
    const base = {
      igAccountId,
      senderId: null,
      senderUsername: null,
      text: null,
      actionPayload: null,
      ignoredReason:
        object !== "instagram" ? `Unexpected webhook object "${object}".` : ownershipReason(igAccountId, own),
    };

    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (isObj(change) && isObj(change.value)) {
          events.push(parseChange(str(change.field) ?? "", change.value, base, envelope, own));
        }
      }
    }
    // Some Instagram webhook formats put field/value directly on the entry.
    if (typeof entry.field === "string" && isObj(entry.value)) {
      events.push(parseChange(entry.field, entry.value, base, envelope, own));
    }
    if (Array.isArray(entry.messaging)) {
      for (const item of entry.messaging) if (isObj(item)) events.push(parseMessaging(item, base, envelope, own));
    }
  }
  return events;
}
