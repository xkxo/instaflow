"use client";

import { useActionState } from "react";
import { Loader2, Lock } from "lucide-react";
import { login, type LoginState } from "./actions";

export function LoginForm({ from }: { from?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {from && <input type="hidden" name="from" value={from} />}
      <div>
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            placeholder="Password"
            aria-invalid={!!state?.error}
            aria-describedby={state?.error ? "login-error" : undefined}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2.5 pl-9 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-700/50"
          />
        </div>
      </div>

      {state?.error && (
        <p id="login-error" role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-100 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
