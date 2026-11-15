/**
 * Sub-path the app is served under, e.g. "/instaflow" for https://example.com/instaflow.
 * Set NEXT_PUBLIC_BASE_PATH at BUILD time (it's inlined into client code). Empty = domain root.
 *
 * Next.js already prefixes <Link>, router navigation and assets. Use withBasePath() for
 * everything else: raw fetch() URLs, window.location, cookie paths, absolute URLs built with
 * new URL(), and redirects from server actions (see actionRedirect()).
 */
export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
