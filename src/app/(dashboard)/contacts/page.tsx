import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { searchContacts } from "@/lib/flow/queries";
import { ContactSearch } from "./contact-search";

export const metadata: Metadata = { title: "Contacts · InstaFlow" };

const RUN_STYLE: Record<string, string> = {
  ACTIVE: "border-sky-900/60 text-sky-300",
  COMPLETED: "border-emerald-900/60 text-emerald-300",
  ABANDONED: "border-amber-900/60 text-amber-300",
  FAILED: "border-red-900/60 text-red-300",
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Follow({ value, checkedAt }: { value: boolean | null; checkedAt: string | null }) {
  const title = checkedAt ? `Checked ${new Date(checkedAt).toUTCString()}` : "Not checked yet";
  if (value === true) return <span title={title} className="rounded-full bg-emerald-950/50 px-2 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-900/60">Follows you</span>;
  if (value === false) return <span title={title} className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-zinc-400 ring-1 ring-zinc-800">Not following</span>;
  return <span title={title} className="text-xs text-zinc-600">Unknown</span>;
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { rows, total } = await searchContacts(q);

  return (
    <>
      <PageHeader title="Contacts" description="Everyone who commented on a matching post or messaged your account." />
      <ContactSearch initial={q} />

      {!rows.length ? (
        q ? (
          <p className="py-12 text-center text-sm text-zinc-500">No contacts match “{q}”.</p>
        ) : (
          <EmptyState icon={Users} title="No contacts yet" description="Contacts are added automatically when someone comments a keyword or messages you." />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800/80 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Follow status</th>
                  <th className="px-3 py-2.5 font-medium">Automations</th>
                  <th className="px-3 py-2.5 font-medium">First seen</th>
                  <th className="px-3 py-2.5 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {rows.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className="px-3 py-2.5">
                      {c.username ? (
                        <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="font-medium text-zinc-100 hover:underline">
                          @{c.username}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-zinc-400">{c.igsid}</span>
                      )}
                      {c.name && <p className="text-xs text-zinc-500">{c.name}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Follow value={c.followsMe} checkedAt={c.followCheckedAt} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.runs.length
                          ? c.runs.map((r) => (
                              <Link
                                key={r.automationId}
                                href={`/automations/${r.automationId}`}
                                title={`${r.status.toLowerCase()} · ${r.step}`}
                                className={`rounded-md border px-1.5 py-0.5 text-xs hover:bg-zinc-900 ${RUN_STYLE[r.status]}`}
                              >
                                {r.automationName}
                              </Link>
                            ))
                          : <span className="text-xs text-zinc-600">—</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">{fmt(c.firstSeenAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">{fmt(c.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > rows.length && <p className="mt-3 text-xs text-zinc-500">Showing the {rows.length} most recent of {total}. Search to narrow down.</p>}
        </>
      )}
    </>
  );
}
