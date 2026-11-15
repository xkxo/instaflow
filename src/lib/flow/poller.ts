import "server-only";
import { drainJobs } from "./jobs";

const INTERVAL_MS = 5_000;
let started = false;

/**
 * In-process job poller for long-running servers (Railway, `next start`, `next dev`).
 * On serverless (Vercel) there's no persistent process: use /api/cron/jobs instead.
 */
export function startJobPoller() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      const { processed } = await drainJobs({ maxMs: 20_000 });
      if (processed) console.info(`[jobs] poller ran ${processed} job(s)`);
    } catch (err) {
      console.error("[jobs] poller error:", err);
    } finally {
      setTimeout(tick, INTERVAL_MS).unref?.();
    }
  };
  setTimeout(tick, INTERVAL_MS).unref?.();
  console.info("[jobs] in-process job poller started");
}
