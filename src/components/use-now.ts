"use client";

import { useEffect, useState } from "react";

/**
 * Current time, ticking every `intervalMs`, or null until mounted. Rendering relative times
 * ("4s ago") or locale-formatted dates only when this is non-null keeps server and client
 * HTML identical, avoiding hydration mismatches.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
