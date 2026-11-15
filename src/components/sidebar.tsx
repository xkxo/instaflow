"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { Logo } from "./logo";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex shrink-0 flex-col border-zinc-800/80 bg-zinc-950 max-md:border-b md:sticky md:top-0 md:h-dvh md:w-60 md:border-r">
      <div className="flex items-center gap-2.5 px-4 py-4 md:px-5 md:py-5">
        <Logo className="size-7" />
        <span className="text-sm font-semibold tracking-tight text-zinc-100">InstaFlow</span>

        {/* Mobile: logout lives in the header row. */}
        <form action={logout} className="ml-auto md:hidden">
          <button
            type="submit"
            aria-label="Log out"
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-zinc-800/70 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <form action={logout} className="hidden border-t border-zinc-800/80 p-3 md:block">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
        >
          <LogOut className="size-4" />
          Log out
        </button>
      </form>
    </aside>
  );
}
