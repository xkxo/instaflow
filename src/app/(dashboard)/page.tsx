import Link from "next/link";
import { CheckCircle2, Link2, MessageCircle, Percent, UserCheck, Workflow, Zap } from "lucide-react";
import { PageHeader } from "@/components/page";
import { dashboardStats, type FunnelStats } from "@/lib/flow/queries";

const STATUS_DOT: Record<string, string> = {
  ACTIVE: "bg-sky-400",
  COMPLETED: "bg-emerald-400",
  ABANDONED: "bg-amber-400",
  FAILED: "bg-red-400",
};

function FunnelRow({ title, s }: { title: string; s: FunnelStats }) {
  const cards = [
    { label: "Comments matched", value: s.matched, icon: Zap },
    { label: "DMs sent", value: s.dmsSent, icon: MessageCircle },
    { label: "Follow-gated", value: s.followGated, icon: UserCheck },
    { label: "Links delivered", value: s.delivered, icon: Link2 },
    { label: "Conversion", value: s.conversion === null ? "—" : `${Math.round(s.conversion * 100)}%`, icon: Percent, hint: "links delivered ÷ comments matched" },
  ];
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map(({ label, value, icon: Icon, hint }) => (
          <div key={label} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4" title={hint}>
            <div className="flex items-center justify-between text-zinc-500">
              <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
              <Icon className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">{typeof value === "number" ? value.toLocaleString("en") : value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function DashboardPage() {
  const s = await dashboardStats();
  return (
    <>
      <PageHeader title="Dashboard" description={`Comment-to-DM performance. “Today” starts at midnight ${s.tz}.`} />

      <FunnelRow title="Today" s={s.today} />
      <FunnelRow title="Last 7 days" s={s.week} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Recent runs</h2>
            <Link href="/logs?tab=runs" className="text-xs text-zinc-400 hover:text-zinc-200">
              All logs →
            </Link>
          </div>
          {s.recent.length ? (
            <ul className="divide-y divide-zinc-800/70">
              {s.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} />
                  <span className="truncate text-zinc-200">@{r.contact.username ?? "unknown"}</span>
                  <span className="truncate text-zinc-500">{r.automation.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">{r.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No runs yet. They&apos;ll appear when someone comments a keyword on your posts.</p>
          )}
        </div>
        <div className="space-y-4">
          <Link href="/automations" className="block rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 transition hover:border-zinc-700">
            <Workflow className="mb-2 size-4 text-zinc-500" />
            <p className="text-2xl font-semibold tabular-nums text-zinc-100">{s.activeAutomations}</p>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Active automations</p>
          </Link>
          <Link href="/contacts" className="block rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 transition hover:border-zinc-700">
            <CheckCircle2 className="mb-2 size-4 text-zinc-500" />
            <p className="text-2xl font-semibold tabular-nums text-zinc-100">{s.contacts.toLocaleString("en")}</p>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Contacts</p>
          </Link>
        </div>
      </div>
    </>
  );
}
