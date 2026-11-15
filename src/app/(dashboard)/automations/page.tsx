import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Info, Plus, Workflow } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { mediaKindLabel } from "@/lib/automations/schema";
import { listAutomations, type AutomationListItem } from "@/lib/automations/store";
import { ActiveToggle } from "./active-toggle";
import { SimulateButton } from "./simulate-button";
import { MediaThumb } from "./editor/media-picker";

export const metadata: Metadata = { title: "Automations · InstaFlow" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-semibold tabular-nums text-zinc-100">{value.toLocaleString("en")}</p>
      <p className="truncate text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}

function AutomationCard({ a }: { a: AutomationListItem }) {
  const trigger =
    a.keywordMode === "ANY"
      ? "Any comment"
      : a.keywords.slice(0, 4).join(", ") + (a.keywords.length > 4 ? ` +${a.keywords.length - 4}` : "");
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 transition hover:border-zinc-700">
      <div className="flex items-start gap-4">
        <MediaThumb
          media={a.mediaScope === "SPECIFIC" ? { id: "x", thumbnailUrl: a.mediaThumbnailUrl, productType: a.mediaProductType } : null}
          className="size-14 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <Link href={`/automations/${a.id}`} className="block truncate text-sm font-semibold text-zinc-100 hover:underline">
            {a.name}
          </Link>
          <p className="mt-0.5 truncate text-sm text-zinc-500">
            {a.mediaScope === "SPECIFIC" ? `${mediaKindLabel({ productType: a.mediaProductType })}: ${a.mediaCaption || "selected post"}` : "Any post or reel"}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5">{trigger}</span>
            {a.followGateEnabled && <span className="rounded bg-zinc-800 px-1.5 py-0.5">Follow gate</span>}
          </p>
        </div>
        <ActiveToggle id={a.id} active={a.active} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-zinc-800/80 pt-3">
        <Stat label="Triggered" value={a.stats.triggered} />
        <Stat label="DMs sent" value={a.stats.dmsSent} />
        <Stat label="Follow-gated" value={a.stats.followGated} />
        <Stat label="Completed" value={a.stats.completed} />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2">
        <SimulateButton
          automationId={a.id}
          defaultComment={a.keywordMode === "KEYWORDS" && a.keywords[0] ? `${a.keywords[0]} please!` : "Love this!"}
          followGate={a.followGateEnabled}
        />
        <Link href={`/automations/${a.id}`} className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          Edit
        </Link>
      </div>
    </div>
  );
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; deleted?: string }>;
}) {
  const { saved, deleted } = await searchParams;
  const automations = await listAutomations();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Automations" description="Comment-to-DM flows. Comments on your posts trigger a DM with your link." />
        <Link
          href="/automations/new"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white"
        >
          <Plus className="size-4" /> New automation
        </Link>
      </div>

      {(saved || deleted) && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="size-4" /> {deleted ? "Automation deleted." : "Automation saved."}
        </div>
      )}

      <div className="mb-6 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
        <Info className="mt-0.5 size-4 shrink-0" />
        Active automations run on real comments. Use “Simulate comment” to test a flow safely: it makes no Instagram API calls
        and isn&apos;t counted in stats.
      </div>

      {automations.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {automations.map((a) => (
            <AutomationCard key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Workflow} title="No automations yet" description="Create one to auto-DM a link to anyone who comments a keyword on your posts." />
      )}
    </>
  );
}
