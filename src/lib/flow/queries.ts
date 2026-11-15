import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";

// ── Runs (Logs page) ────────────────────────────────────────────────────────

export type RunRow = {
  id: string;
  automationId: string;
  automationName: string;
  contactUsername: string | null;
  contactIgsid: string;
  commentText: string | null;
  step: string;
  status: string;
  dryRun: boolean;
  followChecks: number;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  events: { at: string; kind: string; level: string; message: string; data: unknown }[];
};

export async function listRecentRuns(limit = 30): Promise<RunRow[]> {
  const runs = await prisma.flowRun.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      automation: { select: { name: true } },
      contact: { select: { username: true, igsid: true } },
      events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    automationId: r.automationId,
    automationName: r.automation.name,
    contactUsername: r.contact.username,
    contactIgsid: r.contact.igsid,
    commentText: r.commentText,
    step: r.currentStep,
    status: r.status,
    dryRun: r.dryRun,
    followChecks: r.followChecks,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    events: r.events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, level: e.level, message: e.message, data: e.data })),
  }));
}

// ── Dashboard ───────────────────────────────────────────────────────────────

/** "Today" is midnight in APP_TIMEZONE (IANA name, default UTC). */
export function appTimezone(): string {
  const tz = process.env.APP_TIMEZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** UTC instant of the most recent local midnight in `tz`. */
export function startOfToday(tz: string, now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const asUtc = new Date(`${ymd}T00:00:00Z`);
  // Offset of tz at that wall-clock time (handles DST).
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(asUtc)
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(asUtc.getTime() - (wall - asUtc.getTime()));
}

export type FunnelStats = { matched: number; dmsSent: number; followGated: number; delivered: number; conversion: number | null };

/** Both windows in ONE aggregate query (each metric counts runs whose step happened in the window). */
async function funnels(today: Date, week: Date): Promise<{ today: FunnelStats; week: FunnelStats }> {
  const [row] = await prisma.$queryRaw<Record<string, bigint>[]>`
    SELECT
      count(*) FILTER (WHERE "startedAt"     >= ${today}) AS t_matched,
      count(*) FILTER (WHERE "openingSentAt" >= ${today}) AS t_dms,
      count(*) FILTER (WHERE "followGatedAt" >= ${today}) AS t_gated,
      count(*) FILTER (WHERE "completedAt"   >= ${today}) AS t_delivered,
      count(*) FILTER (WHERE "startedAt"     >= ${week})  AS w_matched,
      count(*) FILTER (WHERE "openingSentAt" >= ${week})  AS w_dms,
      count(*) FILTER (WHERE "followGatedAt" >= ${week})  AS w_gated,
      count(*) FILTER (WHERE "completedAt"   >= ${week})  AS w_delivered
    FROM "FlowRun"
    WHERE NOT "dryRun"
      AND ("startedAt" >= ${week} OR "openingSentAt" >= ${week} OR "followGatedAt" >= ${week} OR "completedAt" >= ${week})`;
  const make = (p: "t" | "w"): FunnelStats => {
    const matched = Number(row[`${p}_matched`]);
    const delivered = Number(row[`${p}_delivered`]);
    return { matched, dmsSent: Number(row[`${p}_dms`]), followGated: Number(row[`${p}_gated`]), delivered, conversion: matched ? delivered / matched : null };
  };
  return { today: make("t"), week: make("w") };
}

export async function dashboardStats() {
  const tz = appTimezone();
  const today = startOfToday(tz);
  const week = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); // today + previous 6 days
  const [{ today: t, week: w }, active, contacts, recent] = await Promise.all([
    funnels(today, week),
    prisma.automation.count({ where: { active: true } }),
    prisma.contact.count({ where: { isTest: false } }),
    prisma.flowRun.findMany({
      where: { dryRun: false },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: { automation: { select: { name: true } }, contact: { select: { username: true } } },
    }),
  ]);
  return { tz, today: t, week: w, activeAutomations: active, contacts, recent };
}

// ── Contacts ────────────────────────────────────────────────────────────────

export type ContactRow = {
  id: string;
  igsid: string;
  username: string | null;
  name: string | null;
  followsMe: boolean | null;
  followCheckedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runs: { automationId: string; automationName: string; status: string; step: string }[];
};

export async function searchContacts(q: string, limit = 100): Promise<{ rows: ContactRow[]; total: number }> {
  const term = q.trim().replace(/^@/, "");
  const where: Prisma.ContactWhereInput = {
    isTest: false,
    ...(term
      ? {
          OR: [
            { username: { contains: term, mode: "insensitive" } },
            { name: { contains: term, mode: "insensitive" } },
            { igsid: { contains: term } },
          ],
        }
      : {}),
  };
  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: limit,
      include: { runs: { where: { dryRun: false }, orderBy: { startedAt: "desc" }, include: { automation: { select: { name: true } } } } },
    }),
    prisma.contact.count({ where }),
  ]);
  return {
    total,
    rows: contacts.map((c) => ({
      id: c.id,
      igsid: c.igsid,
      username: c.username,
      name: c.name,
      followsMe: c.followsMe,
      followCheckedAt: c.followCheckedAt?.toISOString() ?? null,
      firstSeenAt: c.firstSeenAt.toISOString(),
      lastSeenAt: c.lastSeenAt.toISOString(),
      runs: c.runs.map((r) => ({ automationId: r.automationId, automationName: r.automation.name, status: r.status, step: r.currentStep })),
    })),
  };
}
