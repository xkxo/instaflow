import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page";
import { listRecentRuns } from "@/lib/flow/queries";
import { listRecentEvents } from "@/lib/webhooks/store";
import { EventsTable } from "./events-table";
import { RunsTable } from "./runs-table";

export const metadata: Metadata = { title: "Logs · InstaFlow" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active = tab === "events" ? "events" : "runs";

  const tabCls = (t: string) =>
    `rounded-md px-3 py-1.5 text-sm transition ${active === t ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`;

  return (
    <>
      <PageHeader title="Logs" description="Flow runs with their step-by-step timeline, and raw webhook events. Refreshes every 5 seconds." />
      <nav className="mb-5 inline-flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5" aria-label="Log type">
        <Link href="/logs?tab=runs" className={tabCls("runs")} aria-current={active === "runs" ? "page" : undefined}>
          Flow runs
        </Link>
        <Link href="/logs?tab=events" className={tabCls("events")} aria-current={active === "events" ? "page" : undefined}>
          Webhook events
        </Link>
      </nav>
      {active === "runs" ? <RunsTable initialRuns={await listRecentRuns(30)} /> : <EventsTable initialEvents={await listRecentEvents(50)} />}
    </>
  );
}
