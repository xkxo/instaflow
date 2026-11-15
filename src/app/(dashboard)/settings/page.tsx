import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page";
import { withBasePath } from "@/lib/base-path";
import { EXPECTED_PERMISSIONS, getMissingMetaConfig, WEBHOOK_FIELDS } from "@/lib/instagram";
import { getInstagramAccount, type InstagramAccountSummary } from "@/lib/instagram-account";
import {
  Avatar,
  ConnectButton,
  DisconnectButton,
  ResubscribeButton,
  TestConnectionButton,
} from "./instagram-controls";

export const metadata: Metadata = { title: "Settings · InstaFlow" };

const FLASH: Record<string, { tone: "success" | "error" | "info"; text: string }> = {
  connected: { tone: "success", text: "Instagram connected." },
  disconnected: { tone: "info", text: "Instagram disconnected. The stored token was deleted." },
  denied: { tone: "error", text: "Login was cancelled, or the requested permissions weren't granted." },
  state_mismatch: { tone: "error", text: "The login session expired or didn't match. Please try connecting again." },
  error: { tone: "error", text: "Connecting Instagram failed. Check the server logs for the Meta error code." },
  not_configured: { tone: "error", text: "Instagram isn't configured yet. Set the META_* env vars first." },
};

const TONE = {
  success: { cls: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300", Icon: CheckCircle2 },
  error: { cls: "border-red-900/60 bg-red-950/30 text-red-300", Icon: XCircle },
  info: { cls: "border-zinc-800 bg-zinc-900/60 text-zinc-300", Icon: Info },
  warning: { cls: "border-amber-900/60 bg-amber-950/30 text-amber-300", Icon: AlertTriangle },
} as const;

function Banner({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  const { cls, Icon } = TONE[tone];
  return (
    <div className={`mb-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

const fmtDate = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";

function Pill({ tone, children }: { tone: "green" | "red" | "zinc"; children: React.ReactNode }) {
  const cls = {
    green: "bg-emerald-950/50 text-emerald-300 ring-emerald-900/60",
    red: "bg-red-950/50 text-red-300 ring-red-900/60",
    zinc: "bg-zinc-900 text-zinc-400 ring-zinc-800",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{children}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-6">
      <dt className="w-40 shrink-0 text-sm text-zinc-500">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-zinc-200">{children}</dd>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-400">{children}</code>;
}

function ConnectedAccount({ account }: { account: InstagramAccountSummary }) {
  const invalid = account.tokenStatus === "INVALID";
  const missingPerms = EXPECTED_PERMISSIONS.filter((p) => !account.scopes.includes(p));

  return (
    <>
      {invalid && (
        <Banner tone="error">
          <strong className="font-medium">The access token no longer works.</strong> {account.tokenStatusReason} Reconnect to
          restore access.
        </Banner>
      )}
      {!invalid && missingPerms.length > 0 && account.scopes.length > 0 && (
        <Banner tone="warning">
          The token is missing <code className="font-mono">{missingPerms.join(", ")}</code>. Add them to the login
          configuration in the App Dashboard, then reconnect.
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Avatar src={account.profilePictureUrl} username={account.username} />
        <div className="min-w-0 flex-1">
          <a
            href={`https://www.instagram.com/${account.username}/`}
            target="_blank"
            rel="noreferrer"
            className="text-base font-semibold text-zinc-100 hover:underline"
          >
            @{account.username}
          </a>
          {account.name && <p className="text-sm text-zinc-500">{account.name}</p>}
        </div>
        {invalid ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-300 ring-1 ring-red-900/60">
            <span className="size-1.5 rounded-full bg-red-400" /> Disconnected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/50 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-900/60">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Connected
          </span>
        )}
      </div>

      <dl className="mt-6 divide-y divide-zinc-800/80 border-y border-zinc-800/80">
        <Row label="Token status">
          {invalid ? <Pill tone="red">Invalid</Pill> : <Pill tone="green">Valid</Pill>}
          <span className="text-zinc-500">
            {account.tokenCheckedAt ? `checked ${fmtDate(account.tokenCheckedAt)}` : "not checked yet"}
          </span>
        </Row>
        <Row label="Token expires">
          {account.tokenExpiresAt ? fmtDate(account.tokenExpiresAt) : <Pill tone="zinc">Never</Pill>}
        </Row>
        <Row label="Instagram account ID">
          <Code>{account.igAccountId}</Code>
        </Row>
        {account.clientBusinessId && (
          <Row label="Business portfolio ID">
            <Code>{account.clientBusinessId}</Code>
          </Row>
        )}
        <Row label="Permissions">
          {account.scopes.length ? account.scopes.map((s) => <Code key={s}>{s}</Code>) : "—"}
        </Row>
      </dl>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <TestConnectionButton />
        <div className="flex flex-wrap gap-2">
          {invalid && <ConnectButton label="Reconnect" />}
          <DisconnectButton username={account.username} />
        </div>
      </div>
    </>
  );
}

/** Public webhook URL: same origin as META_REDIRECT_URI (the app's public HTTPS host). */
function webhookCallbackUrl(): string | null {
  try {
    return process.env.META_REDIRECT_URI
      ? new URL(withBasePath("/api/webhooks/instagram"), process.env.META_REDIRECT_URI).toString()
      : null;
  } catch {
    return null;
  }
}

function WebhooksSection({ account }: { account: InstagramAccountSummary }) {
  const callbackUrl = webhookCallbackUrl();
  const hasVerifyToken = !!process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();

  return (
    <section className="mt-6 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-6">
      <h2 className="text-sm font-semibold text-zinc-100">Webhooks</h2>
      <p className="mb-4 mt-1 text-sm text-zinc-500">
        Real-time comments and DMs from Meta. Enter the callback URL and verify token under{" "}
        <span className="text-zinc-400">API setup with Unified login → Configure webhooks</span> in the App Dashboard.
      </p>

      {account.webhookError && <Banner tone="warning">{account.webhookError}</Banner>}

      <dl className="divide-y divide-zinc-800/80 border-y border-zinc-800/80">
        <Row label="Callback URL">
          {callbackUrl ? <Code>{callbackUrl}</Code> : <span className="text-zinc-500">Set META_REDIRECT_URI to derive it</span>}
        </Row>
        <Row label="Verify token">
          {hasVerifyToken ? (
            <Pill tone="green">Configured</Pill>
          ) : (
            <span className="text-amber-300">
              Set <code className="font-mono">META_WEBHOOK_VERIFY_TOKEN</code>
            </span>
          )}
        </Row>
        <Row label="Subscribed fields">
          {WEBHOOK_FIELDS.map((f) =>
            account.webhookFields.includes(f) ? (
              <Pill key={f} tone="green">
                ✓ {f}
              </Pill>
            ) : (
              <Pill key={f} tone="red">
                ✗ {f}
              </Pill>
            ),
          )}
        </Row>
        <Row label="Last checked">
          {account.webhookCheckedAt ? fmtDate(account.webhookCheckedAt) : <span className="text-zinc-500">never</span>}
        </Row>
      </dl>

      <div className="mt-6">
        <ResubscribeButton />
      </div>
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ instagram?: string | string[] }>;
}) {
  const { instagram } = await searchParams;
  const flash = typeof instagram === "string" ? FLASH[instagram] : undefined;
  const missing = getMissingMetaConfig();
  const account = await getInstagramAccount();

  return (
    <>
      <PageHeader title="Settings" description="Instagram connection and app preferences." />

      {flash && <Banner tone={flash.tone}>{flash.text}</Banner>}

      <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-6">
        <h2 className="text-sm font-semibold text-zinc-100">Instagram account</h2>
        <p className="mb-6 mt-1 text-sm text-zinc-500">
          Connected through the Instagram API with Unified Login. The token is encrypted at rest and checked daily.
        </p>

        {account ? (
          <ConnectedAccount account={account} />
        ) : missing.length ? (
          <Banner tone="warning">
            Set <code className="font-mono">{missing.join(", ")}</code> in your environment, then restart the server. See
            the README for how to set up the Meta app.
          </Banner>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-zinc-400">
              No account connected. You&apos;ll log in with Facebook or Instagram, pick your business portfolio and
              Instagram account, and approve:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXPECTED_PERMISSIONS.map((s) => (
                <Code key={s}>{s}</Code>
              ))}
            </div>
            <ConnectButton />
          </div>
        )}
      </section>

      {account && <WebhooksSection account={account} />}
    </>
  );
}
