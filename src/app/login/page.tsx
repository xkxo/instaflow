import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · InstaFlow" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-10" />
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">InstaFlow</h1>
            <p className="text-sm text-zinc-500">Enter your password to continue</p>
          </div>
        </div>
        <LoginForm from={typeof from === "string" ? from : undefined} />
      </div>
    </main>
  );
}
