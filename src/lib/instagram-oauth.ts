// Shared constants for the Instagram OAuth state cookie (used by the connect action and callback).
export const OAUTH_STATE_COOKIE = "ig_oauth_state";
export const OAUTH_CALLBACK_PATH = "/api/instagram/callback";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

/** Result codes passed back to /settings?instagram=<code>. Fixed values only, never raw text. */
export const CONNECT_RESULTS = ["connected", "denied", "state_mismatch", "error", "not_configured"] as const;
export type ConnectResult = (typeof CONNECT_RESULTS)[number];
