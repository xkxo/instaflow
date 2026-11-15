"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";

/** Debounced search box that updates ?q= (server-side search). */
export function ContactSearch({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (value === initial) return;
    const t = setTimeout(() => {
      start(() => router.replace(value.trim() ? `${pathname}?q=${encodeURIComponent(value.trim())}` : pathname));
    }, 300);
    return () => clearTimeout(t);
  }, [value, initial, pathname, router]);

  return (
    <div className="relative mb-4 max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search username, name or ID…"
        aria-label="Search contacts"
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-9 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
      />
      {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-zinc-500" />}
    </div>
  );
}
