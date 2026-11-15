import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: host ? [host.split(":")[0]] : [],
  experimental: {
    serverActions: { allowedOrigins: host ? [host] : [] },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
