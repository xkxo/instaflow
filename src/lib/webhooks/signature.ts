import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's `X-Hub-Signature-256: sha256=<hex>` header: HMAC-SHA256 of the RAW request
 * body bytes, keyed with the Meta app secret. Must run on the exact bytes received (re-serialising
 * parsed JSON changes escaping and breaks the signature).
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length).trim();
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(provided, "hex"));
}
