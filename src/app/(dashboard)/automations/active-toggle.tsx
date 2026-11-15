"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toggleAutomationAction } from "./actions";
import { Toggle } from "./editor/fields";

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(active);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const change = (next: boolean) =>
    startTransition(async () => {
      setOptimistic(next);
      setError(null);
      const res = await toggleAutomationAction(id, next);
      if (res.error) setError(res.error);
    });

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        {optimistic ? "Active" : "Paused"}
        <Toggle checked={optimistic} onChange={change} label={optimistic ? "Pause automation" : "Activate automation"} />
      </label>
      {error && <p className="max-w-40 text-right text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
