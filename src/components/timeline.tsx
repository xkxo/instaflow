"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, XCircle } from "lucide-react";

export type TimelineEvent = { at: string; kind: string; level: string; message: string; data: unknown };

const ICON = {
  info: <Circle className="size-3 fill-zinc-500 text-zinc-500" />,
  warn: <AlertTriangle className="size-3.5 text-amber-400" />,
  error: <XCircle className="size-3.5 text-red-400" />,
};

function EventRow({ e }: { e: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const done = e.kind === "completed";
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1 grid size-4 place-items-center">
        {done ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : ICON[e.level as keyof typeof ICON] ?? ICON.info}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <time className="font-mono text-[11px] tabular-nums text-zinc-500" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
          {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </time>
        <span className="font-mono text-[11px] text-zinc-500">{e.kind}</span>
      </div>
      <p className={`text-sm ${e.level === "error" ? "text-red-300" : e.level === "warn" ? "text-amber-200" : "text-zinc-200"}`}>{e.message}</p>
      {e.data !== null && e.data !== undefined && (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-zinc-300">
            <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} /> details
          </button>
          {open && (
            <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
              {JSON.stringify(e.data, null, 2)}
            </pre>
          )}
        </>
      )}
    </li>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-sm text-zinc-500">No events yet.</p>;
  return (
    <ol className="space-y-3 border-l border-zinc-800 pl-3">
      {events.map((e, i) => (
        <EventRow key={i} e={e} />
      ))}
    </ol>
  );
}
