"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Radio, Workflow } from "lucide-react";
import type { RunRow } from "@/lib/flow/queries";
import { Timeline } from "@/components/timeline";
import { useNow } from "@/components/use-now";

const POLL_MS = 5000;

const STATUS: Record<string, string> = {
  ACTIVE: "bg-sky-950/50 text-sky-300 ring-sky-900/60",
  COMPLETED: "bg-emerald-950/50 text-emerald-300 ring-emerald-900/60",
  ABANDONED: "bg-amber-950/50 text-amber-300 ring-amber-900/60",
  FAILED: "bg-red-950/50 text-red-300 ring-red-900/60",
};

const STEP: Record<string, string> = {
  TRIGGERED: "Matched",
  AWAITING_OPT_IN: "Awaiting tap",
  AWAITING_FOLLOW: "Awaiting follow",
  DELIVERING: "Delivering",
  DELIVERED: "Delivered",
};

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function RunsTable({ initialRuns }: { initialRuns: RunRow[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const res = await fetch("/api/runs?limit=30", { cache: "no-store" });
      if (res.status === 401) return void (window.location.href = "/login?from=/logs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRuns(((await res.json()) as { runs: RunRow[] }).runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <Radio className={`size-3.5 ${error ? "text-red-400" : "text-emerald-400"}`} /> {error ? `Refresh failed (${error})` : "Live"}
        </span>
        <span>{runs.length} most recent runs</span>
      </div>

      {!runs.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 py-16 text-center">
          <Workflow className="mb-3 size-6 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-200">No flow runs yet</h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            Runs appear when a comment matches an active automation, or when you use “Simulate comment”.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800/80 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Updated</th>
                <th className="px-3 py-2.5 font-medium">Automation</th>
                <th className="px-3 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Step</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {runs.map((r) => {
                const open = expanded === r.id;
                const last = r.events[r.events.length - 1];
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setExpanded(open ? null : r.id)} aria-expanded={open} className="cursor-pointer align-top transition hover:bg-zinc-900/50">
                      <td className="px-3 py-2.5 text-zinc-500">
                        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400" title={now ? new Date(r.updatedAt).toLocaleString() : undefined}>
                        {now ? ago(r.updatedAt, now) : " "}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-200">
                        {r.automationName}
                        {r.dryRun && <span className="ml-2 rounded bg-violet-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">Simulated</span>}
                        {last && <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-zinc-500">{last.message}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-300">{r.contactUsername ? `@${r.contactUsername}` : r.contactIgsid}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">
                        {STEP[r.step] ?? r.step}
                        {r.followChecks > 0 && <span className="ml-1 text-xs text-zinc-500">({r.followChecks} check{r.followChecks === 1 ? "" : "s"})</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span title={r.error ?? undefined} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS[r.status] ?? STATUS.ACTIVE}`}>
                          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-zinc-950">
                        <td />
                        <td colSpan={5} className="px-3 pb-5 pt-2">
                          {r.commentText && <p className="mb-3 text-xs text-zinc-500">Comment: “{r.commentText}”</p>}
                          <Timeline events={r.events} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
