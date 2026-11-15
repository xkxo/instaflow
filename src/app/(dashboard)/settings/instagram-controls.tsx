"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, PlugZap, RefreshCw, Unplug, XCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import {
  connectInstagram,
  disconnect,
  resubscribe,
  testConnection,
  type ResubscribeState,
  type TestState,
} from "./actions";

function Spinner() {
  return <Loader2 className="size-4 animate-spin" />;
}

function ConnectSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-rose-500/10 transition hover:brightness-110 disabled:opacity-60"
    >
      {pending ? <Spinner /> : <PlugZap className="size-4" />}
      {pending ? "Redirecting…" : label}
    </button>
  );
}

export function ConnectButton({ label = "Connect Instagram" }: { label?: string }) {
  return (
    <form action={connectInstagram}>
      <ConnectSubmit label={label} />
    </form>
  );
}

export function TestConnectionButton() {
  const [state, action, pending] = useActionState<TestState>(testConnection, undefined);

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? <Spinner /> : <CheckCircle2 className="size-4" />}
          {pending ? "Testing…" : "Test connection"}
        </button>
      </form>
      {state && !pending && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          {state.message}
        </p>
      )}
    </div>
  );
}

export function ResubscribeButton() {
  const [state, action, pending] = useActionState<ResubscribeState>(resubscribe, undefined);

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending ? <Spinner /> : <RefreshCw className="size-4" />}
          {pending ? "Subscribing…" : "Resubscribe"}
        </button>
      </form>
      {state && !pending && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-sm ${state.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          {state.message}
        </p>
      )}
    </div>
  );
}

function DisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg border border-red-900/60 px-3.5 py-2 text-sm font-medium text-red-400 transition hover:border-red-800 hover:bg-red-950/40 disabled:opacity-60"
    >
      {pending ? <Spinner /> : <Unplug className="size-4" />}
      Disconnect
    </button>
  );
}

export function DisconnectButton({ username }: { username: string }) {
  return (
    <form
      action={disconnect}
      onSubmit={(e) => {
        if (!confirm(`Disconnect @${username}? The stored access token will be deleted.`)) e.preventDefault();
      }}
    >
      <DisconnectSubmit />
    </form>
  );
}

/** Profile pictures are short-lived CDN URLs; fall back to an initial if one has expired. */
export function Avatar({ src, username }: { src: string | null; username: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-lg font-semibold uppercase text-white">
        {username.charAt(0)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, expiring CDN URL
    <img
      src={src}
      alt={`@${username}`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-14 rounded-full object-cover ring-2 ring-zinc-800"
    />
  );
}
