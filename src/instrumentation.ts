/**
 * Runs once when the server starts. Starts the in-process flow-job poller on long-running
 * Node servers. Skipped on Vercel (serverless: use /api/cron/jobs) or when JOB_POLLER=off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL || process.env.JOB_POLLER === "off") return;
  if (!process.env.DATABASE_URL) return;
  const { startJobPoller } = await import("./lib/flow/poller");
  startJobPoller();
}
