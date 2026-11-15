"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FlaskConical, Loader2, X } from "lucide-react";
import type { SimulationResult } from "@/lib/flow/simulate";
import { simulateAction } from "./actions";
import { Timeline } from "@/components/timeline";

type Scenario = "already" | "after1" | "after2" | "never";
const SCENARIOS: { value: Scenario; label: string; followsAfterChecks: number | null }[] = [
  { value: "already", label: "Already follows", followsAfterChecks: 0 },
  { value: "after1", label: "Follows after 1st reminder", followsAfterChecks: 1 },
  { value: "after2", label: "Follows after 2nd reminder", followsAfterChecks: 2 },
  { value: "never", label: "Never follows", followsAfterChecks: null },
];

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: "bg-emerald-950/50 text-emerald-300 ring-emerald-900/60",
  ABANDONED: "bg-amber-950/50 text-amber-300 ring-amber-900/60",
  FAILED: "bg-red-950/50 text-red-300 ring-red-900/60",
  ACTIVE: "bg-zinc-900 text-zinc-300 ring-zinc-800",
};

export function SimulateButton({
  automationId,
  defaultComment,
  followGate,
  variant = "ghost",
}: {
  automationId: string;
  defaultComment: string;
  followGate: boolean;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(defaultComment);
  const [username, setUsername] = useState("test.user");
  const [name, setName] = useState("Test User");
  const [scenario, setScenario] = useState<Scenario>("after1");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      setResult(null);
      const res = await simulateAction(automationId, {
        comment,
        username,
        name,
        followsAfterChecks: SCENARIOS.find((s) => s.value === scenario)!.followsAfterChecks,
      });
      if (res.ok) setResult(res.result);
      else setError(res.error);
    });

  const input = "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
          variant === "outline" ? "border border-zinc-700 text-zinc-300 hover:bg-zinc-900" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
      >
        <FlaskConical className="size-4" /> Simulate comment
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !pending && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Simulate comment"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Simulate comment (dry run)</h2>
                <p className="text-xs text-zinc-500">Runs the real flow logic on the saved automation. No Instagram API calls are made.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800">
                <X className="size-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-zinc-400">Comment</span>
                  <input id="sim-comment" value={comment} onChange={(e) => setComment(e.target.value)} className={input} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-400">Commenter username</span>
                  <input id="sim-username" value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-zinc-400">Their name (for {"{first_name}"})</span>
                  <input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
                </label>
                {followGate && (
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-zinc-400">Follow scenario</span>
                    <select id="sim-scenario" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)} className={input}>
                      {SCENARIOS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <button
                type="button"
                onClick={run}
                disabled={pending}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-60"
              >
                {pending && <Loader2 className="size-4 animate-spin" />} Run simulation
              </button>

              {error && <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}

              {result && !result.matched && (
                <p className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
                  Not triggered: {result.reason}
                </p>
              )}

              {result?.matched && (
                <div className="mt-5 space-y-5">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-zinc-400">Outcome:</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[result.status ?? "ACTIVE"]}`}>
                      {result.status}
                    </span>
                    <span className="text-zinc-500">step {result.step}</span>
                    <Link href="/logs?tab=runs" className="ml-auto text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200">
                      View in Logs
                    </Link>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Timeline</h3>
                    <Timeline events={result.timeline} />
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      API requests that would be sent ({result.calls.length})
                    </h3>
                    <ol className="space-y-2">
                      {result.calls.map((c, i) => (
                        <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
                          <p className="font-mono text-xs text-zinc-300">
                            <span className={c.method === "GET" ? "text-sky-400" : "text-emerald-400"}>{c.method}</span> graph.facebook.com{c.path}
                            {c.query ? `?${new URLSearchParams(c.query).toString()}` : ""}
                          </p>
                          {c.body !== undefined && (
                            <pre className="mt-1.5 max-h-48 overflow-auto font-mono text-[11px] leading-relaxed text-zinc-400">{JSON.stringify(c.body, null, 2)}</pre>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
