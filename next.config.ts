import type { NextConfig } from "next";
import { normalizeBasePath } from "./src/lib/base-path";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No includeSubDomains: the app may share a domain with other sites (e.g. served under a sub-path).
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

/**
 * The host from META_REDIRECT_URI (e.g. an HTTPS tunnel during local development).
 * Next.js rejects server actions whose Origin doesn't match the Host header, and blocks
 * dev assets from unknown hosts. Behind a tunnel these can differ, so trust this one host.
 */
function appHost(): string | undefined {
  try {
    return process.env.META_REDIRECT_URI ? new URL(process.env.META_REDIRECT_URI).host : undefined;
  } catch {
    return undefined;
  }
}
const host = appHost();
const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Serve under a sub-path, e.g. NEXT_PUBLIC_BASE_PATH=/instaflow (set at build time).
  ...(basePath ? { basePath } : {}),
  // Self-contained server bundle for copying to a VPS (NEXT_OUTPUT=standalone at build time).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  allowedDevOrigins: host ? [host.split(":")[0]] : [],
  experimental: {
    serverActions: { allowedOrigins: host ? [host] : [] },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
