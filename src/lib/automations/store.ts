import "server-only";
import { prisma } from "../db";
import type { Automation } from "@/generated/prisma/client";
import {
  type AutomationInput,
  DEFAULT_AUTOMATION,
  normalizeAutomation,
  validateAutomation,
  type ValidationResult,
} from "./schema";

export type AutomationStats = { triggered: number; dmsSent: number; followGated: number; completed: number };

export type AutomationListItem = {
  id: string;
  name: string;
  active: boolean;
  mediaScope: "ANY" | "SPECIFIC";
  mediaThumbnailUrl: string | null;
  mediaPermalink: string | null;
  mediaCaption: string | null;
  mediaProductType: string | null;
  keywordMode: "ANY" | "KEYWORDS";
  keywords: string[];
  followGateEnabled: boolean;
  updatedAt: Date;
  stats: AutomationStats;
};

/** All automations with per-automation run stats (from FlowRun). */
export async function listAutomations(): Promise<AutomationListItem[]> {
  const automations = await prisma.automation.findMany({ orderBy: [{ active: "desc" }, { updatedAt: "desc" }] });
  // All four stats in one aggregate query. Simulated (dry-run) runs never count.
  const rows = await prisma.$queryRaw<{ automationId: string; triggered: bigint; dms: bigint; gated: bigint; completed: bigint }[]>`
    SELECT "automationId",
           count(*)                                          AS triggered,
           count(*) FILTER (WHERE "openingSentAt" IS NOT NULL) AS dms,
           count(*) FILTER (WHERE "followGatedAt" IS NOT NULL) AS gated,
           count(*) FILTER (WHERE "status" = 'COMPLETED')      AS completed
    FROM "FlowRun"
    WHERE NOT "dryRun"
    GROUP BY "automationId"`;
  const byId = new Map(rows.map((r) => [r.automationId, r]));
  const n = (v: bigint | undefined) => Number(v ?? 0);

  return automations.map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    mediaScope: a.mediaScope,
    mediaThumbnailUrl: a.mediaThumbnailUrl,
    mediaPermalink: a.mediaPermalink,
    mediaCaption: a.mediaCaption,
    mediaProductType: a.mediaProductType,
    keywordMode: a.keywordMode,
    keywords: a.keywords,
    followGateEnabled: a.followGateEnabled,
    updatedAt: a.updatedAt,
    stats: (() => {
      const s = byId.get(a.id);
      return { triggered: n(s?.triggered), dmsSent: n(s?.dms), followGated: n(s?.gated), completed: n(s?.completed) };
    })(),
  }));
}

/** DB row → editor input. */
export function toInput(a: Automation): AutomationInput {
  return {
    name: a.name,
    active: a.active,
    mediaScope: a.mediaScope,
    media: a.mediaId
      ? {
          id: a.mediaId,
          permalink: a.mediaPermalink,
          thumbnailUrl: a.mediaThumbnailUrl,
          caption: a.mediaCaption,
          mediaType: a.mediaType,
          productType: a.mediaProductType,
        }
      : null,
    keywordMode: a.keywordMode,
    keywords: a.keywords,
    keywordMatch: a.keywordMatch,
    publicReplyEnabled: a.publicReplyEnabled,
    publicReplies: a.publicReplies,
    openingMessage: a.openingMessage,
    openingButton: a.openingButton,
    followGateEnabled: a.followGateEnabled,
    notFollowingMessage: a.notFollowingMessage ?? "",
    notFollowingButton: a.notFollowingButton ?? "",
    maxFollowChecks: a.maxFollowChecks,
    deliveryMessage: a.deliveryMessage,
    deliveryCardTitle: a.deliveryCardTitle,
    deliveryUrl: a.deliveryUrl,
    deliveryButton: a.deliveryButton,
  };
}

export async function getAutomation(id: string): Promise<Automation | null> {
  return prisma.automation.findUnique({ where: { id } });
}

/** Input → DB columns. Media and follow-gate fields are cleared when not in use. */
function toData(a: AutomationInput) {
  const specific = a.mediaScope === "SPECIFIC" && a.media;
  return {
    name: a.name,
    active: a.active,
    mediaScope: a.mediaScope,
    mediaId: specific ? a.media!.id : null,
    mediaPermalink: specific ? (a.media!.permalink ?? null) : null,
    mediaThumbnailUrl: specific ? (a.media!.thumbnailUrl ?? null) : null,
    mediaCaption: specific ? (a.media!.caption ?? null) : null,
    mediaType: specific ? (a.media!.mediaType ?? null) : null,
    mediaProductType: specific ? (a.media!.productType ?? null) : null,
    keywordMode: a.keywordMode,
    keywords: a.keywordMode === "KEYWORDS" ? a.keywords : [],
    keywordMatch: a.keywordMatch,
    publicReplyEnabled: a.publicReplyEnabled,
    publicReplies: a.publicReplies,
    openingMessage: a.openingMessage,
    openingButton: a.openingButton,
    followGateEnabled: a.followGateEnabled,
    notFollowingMessage: a.followGateEnabled ? a.notFollowingMessage : a.notFollowingMessage || null,
    notFollowingButton: a.followGateEnabled ? a.notFollowingButton : a.notFollowingButton || null,
    // Validated when the gate is on; otherwise keep a sane default instead of an invalid number.
    maxFollowChecks: Number.isInteger(a.maxFollowChecks) ? a.maxFollowChecks : DEFAULT_AUTOMATION.maxFollowChecks,
    deliveryMessage: a.deliveryMessage,
    deliveryCardTitle: a.deliveryCardTitle,
    deliveryUrl: a.deliveryUrl,
    deliveryButton: a.deliveryButton,
  };
}

export type SaveResult = { ok: true; id: string } | { ok: false; validation: ValidationResult };

/** Normalise + validate (authoritative, server-side) + save. */
export async function saveAutomation(id: string | null, raw: unknown): Promise<SaveResult> {
  const input = normalizeAutomation(raw);
  const validation = validateAutomation(input);
  if (!validation.ok) return { ok: false, validation };

  const data = toData(input);
  const saved = id
    ? await prisma.automation.update({ where: { id }, data, select: { id: true } })
    : await prisma.automation.create({ data, select: { id: true } });
  return { ok: true, id: saved.id };
}

export async function setAutomationActive(id: string, active: boolean): Promise<void> {
  if (active) {
    // Only complete, valid automations may run.
    const row = await prisma.automation.findUnique({ where: { id } });
    if (!row) throw new Error("Automation not found.");
    const v = validateAutomation(toInput(row));
    if (!v.ok) throw new Error("Fix the automation's errors before activating it.");
  }
  await prisma.automation.update({ where: { id }, data: { active } });
}

export async function deleteAutomation(id: string): Promise<void> {
  await prisma.automation.delete({ where: { id } });
}
