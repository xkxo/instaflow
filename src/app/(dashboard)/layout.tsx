import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { requireAuth } from "@/lib/auth";
import { getTokenAlert } from "@/lib/instagram-account";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts already gates these routes; this re-checks server-side as defense in depth.
  await requireAuth();
  const tokenAlert = await getTokenAlert();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar />
      <main className="flex-1">
        {tokenAlert && (
          <div role="alert" className="border-b border-red-900/70 bg-red-950/60 px-5 py-3 text-sm text-red-200 md:px-10">
            <div className="mx-auto flex max-w-5xl items-start gap-2.5">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-red-400" />
              <p>
                <strong className="font-medium text-red-100">Instagram access lost for @{tokenAlert.username}.</strong>{" "}
                {tokenAlert.reason}{" "}
                <Link href="/settings" className="font-medium text-red-100 underline underline-offset-2 hover:text-white">
                  Reconnect in Settings
                </Link>
              </p>
            </div>
          </div>
        )}
        <div className="px-5 py-8 md:px-10 md:py-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
