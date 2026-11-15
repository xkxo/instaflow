import { after, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { verifyWebhookSignature } from "@/lib/webhooks/signature";
import { drainJobs } from "@/lib/flow/jobs";
import { ingestWebhook, processPendingEvents } from "@/lib/webhooks/store";

/**
 * Meta webhook endpoint (object "instagram"). Public: proxy.ts skips the session check
 * for /api/webhooks/*. Security comes from the verify token (GET) and the signature (POST).
 */
export const dynamic = "force-dynamic";
/** Room for after() to work through the first flow steps (DMs are sent 2–6 s apart). */
export const maxDuration = 60;

/** Verification handshake when you save the callback URL in the App Dashboard. */
export async function GET(request: NextRequest) {
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expected) {
    console.error("[webhooks] META_WEBHOOK_VERIFY_TOKEN is not set; cannot verify subscription");
    return new Response("Webhook verify token not configured", { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token && challenge && safeEqual(token, expected)) {
    console.info("[webhooks] verification handshake succeeded");
    // Plain text so the echoed challenge can never be interpreted as HTML.
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  console.warn(`[webhooks] verification handshake rejected (mode=${mode ?? "?"}, token ${token ? "mismatch" : "missing"})`);
  return new Response("Forbidden", { status: 403 });
}

/** Event notifications. */
export async function POST(request: NextRequest) {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    console.error("[webhooks] META_APP_SECRET is not set; cannot verify signatures");
    return new Response("Not configured", { status: 500 }); // 5xx → Meta retries later
  }

  // Signature is computed over the raw bytes, so read them before any parsing.
  const raw = Buffer.from(await request.arrayBuffer());
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn(`[webhooks] rejected POST with invalid or missing X-Hub-Signature-256 (${raw.length} bytes)`);
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    console.warn("[webhooks] signed body is not valid JSON; dropping");
    return new Response("Bad JSON", { status: 400 });
  }

  // Save first (a fast insert), so a crash after we answer can't lose events. On DB failure,
  // answer 5xx and Meta will redeliver.
  try {
    const r = await ingestWebhook(body);
    console.info(
      `[webhooks] received ${r.received} event(s): ${r.inserted} new, ${r.duplicates} duplicate, ${r.ignored} ignored`,
    );
  } catch (err) {
    console.error("[webhooks] failed to store events:", err);
    return new Response("Storage error", { status: 500 });
  }

  // Slow work happens after the 200 is sent: turn events into flow jobs, then run due jobs
  // (waiting through the 2–6 s human delays). Retries later are picked up by the poller / cron.
  after(async () => {
    try {
      const p = await processPendingEvents();
      if (p.processed || p.failed) console.info(`[webhooks] processed ${p.processed}, failed ${p.failed}`);
      const j = await drainJobs({ maxMs: 25_000 });
      if (j.processed) console.info(`[jobs] ran ${j.processed} job(s)`);
    } catch (err) {
      console.error("[webhooks] background processing failed:", err);
    }
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}
