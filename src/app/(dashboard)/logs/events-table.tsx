"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Radio, ScrollText } from "lucide-react";
import type { WebhookEventRow } from "@/lib/webhooks/store";
import { useNow } from "@/components/use-now";
import { withBasePath } from "@/lib/base-path";

const POLL_MS = 5000;

const STATUS: Record<WebhookEventRow["status"], { label: string; cls: string }> = {
  processed: { label: "Processed", cls: "bg-emerald-950/50 text-emerald-300 ring-emerald-900/60" },
  ignored: { label: "Ignored", cls: "bg-zinc-900 text-zinc-400 ring-zinc-800" },
  failed: { label: "Failed", cls: "bg-red-950/50 text-red-300 ring-red-900/60" },
  pending: { label: "Pending", cls: "bg-amber-950/50 text-amber-300 ring-amber-900/60" },
};

const TYPE_LABEL: Record<string, string> = {
  comment: "Comment",
  live_comment: "Live comment",
  message: "Message",
  quick_reply: "Quick reply",
  postback: "Postback",
};

function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function EventsTable({ initialEvents }: { initialEvents: WebhookEventRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    try {
      const res = await fetch(withBasePath("/api/events?limit=50"), { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = withBasePath("/login?from=/logs");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: WebhookEventRow[] };
      setEvents(data.events);
      setLastFetch(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <Radio className={`size-3.5 ${error ? "text-red-400" : "text-emerald-400"}`} />
          {error
            ? `Refresh failed (${error}), retrying…`
            : now && lastFetch
              ? `Live · updated ${timeAgo(new Date(lastFetch).toISOString(), now)}`
              : "Live"}
        </span>
        <span>{events.length} most recent</span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 py-16 text-center">
          <div className="mb-4 grid size-10 place-items-center rounded-lg bg-zinc-900 text-zinc-400">
            <ScrollText className="size-5" />
          </div>
          <h2 className="text-sm font-medium text-zinc-200">No webhook events yet</h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            Comment on one of your posts or send your account a DM, and events will appear here within seconds.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800/80 bg-zinc-900/40 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 font-medium">Received</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">From</th>
                <th className="px-3 py-2.5 font-medium">Text</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {events.map((e) => {
                const open = expanded === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : e.id)}
                      className="cursor-pointer align-top transition hover:bg-zinc-900/50"
                      aria-expanded={open}
                    >
                      <td className="px-3 py-2.5 text-zinc-500">
                        <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400" title={now ? new Date(e.receivedAt).toLocaleString() : undefined}>
                        {now ? timeAgo(e.receivedAt, now) : " "}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-200">
                        {TYPE_LABEL[e.type] ?? e.type}
                        {e.deliveryCount > 1 && (
                          <span className="ml-1.5 text-xs text-zinc-500" title="Duplicate deliveries from Meta">
                            ×{e.deliveryCount}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-300">
                        {e.senderUsername ? `@${e.senderUsername}` : <span className="text-zinc-500">{e.senderId ?? "—"}</span>}
                      </td>
                      <td className="max-w-md px-3 py-2.5 text-zinc-300">
                        <span className="line-clamp-2 break-words">{e.text ?? <span className="text-zinc-600">—</span>}</span>
                        {e.actionPayload && (
                          <code className="mt-1 inline-block rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
                            {e.actionPayload}
                          </code>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span
                          title={e.statusDetail ?? undefined}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS[e.status].cls}`}
                        >
                          {STATUS[e.status].label}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-zinc-950">
                        <td />
                        <td colSpan={5} className="px-3 pb-4 pt-1">
                          {e.statusDetail && (
                            <p className={`mb-2 text-xs ${e.status === "failed" ? "text-red-400" : "text-zinc-500"}`}>
                              {e.statusDetail}
                            </p>
                          )}
                          <pre className="max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
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
