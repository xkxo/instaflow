/**
 * Automation definition shared by the editor (client) and the server: types, Instagram limits,
 * template variables and validation. Pure: no I/O, safe to import anywhere.
 */

// ── Instagram limits ────────────────────────────────────────────────────────
// Sources: Instagram Platform messaging docs (text ≤ 1000 bytes UTF-8; quick-reply titles are
// truncated after 20 chars; generic template title/subtitle ≤ 80 chars, ≤ 3 buttons).

export const LIMITS = {
  /** DM text, in UTF-8 BYTES (an emoji is 4). */
  dmBytes: 1000,
  /** Quick-reply button title, in characters (Meta truncates longer titles). */
  quickReplyChars: 20,
  /** Generic template card title, in characters. */
  cardTitleChars: 80,
  /** URL button title, in characters. */
  buttonTitleChars: 20,
  /** Public comment reply, in characters. */
  commentChars: 2200,
  urlChars: 2000,
  nameChars: 100,
  keywordChars: 100,
  maxKeywords: 50,
  maxPublicReplies: 10,
  minFollowChecks: 1,
  maxFollowChecks: 10,
} as const;

// ── Template variables ──────────────────────────────────────────────────────

/** Supported variables, with preview samples and worst-case sizes for limit checks. */
export const VARIABLES = {
  first_name: { label: "{first_name}", sample: "Jess", maxChars: 30, maxBytes: 60 },
  username: { label: "{username}", sample: "jess.prints", maxChars: 30, maxBytes: 30 },
} as const;
export type VariableName = keyof typeof VARIABLES;

const VAR_RE = /\{([a-z_]+)\}/g;

export function renderTemplate(text: string, values: Partial<Record<VariableName, string>>): string {
  return text.replace(VAR_RE, (whole, name: string) =>
    name in VARIABLES ? (values[name as VariableName] ?? "") : whole,
  );
}

export function unknownVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]).filter((n) => !(n in VARIABLES)))];
}

const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).length;
export const charLength = (s: string) => [...s].length;

/** Size of a template as written, and in the worst case after variables are filled in. */
export function measure(text: string) {
  const worstChars = renderTemplate(text, { first_name: "x".repeat(VARIABLES.first_name.maxChars), username: "x".repeat(VARIABLES.username.maxChars) });
  const worstBytes = renderTemplate(text, {
    first_name: "x".repeat(VARIABLES.first_name.maxBytes),
    username: "x".repeat(VARIABLES.username.maxBytes),
  });
  const hasVariables = worstChars !== text;
  return {
    chars: charLength(text),
    bytes: byteLength(text),
    maxChars: charLength(worstChars),
    maxBytes: byteLength(worstBytes),
    hasVariables,
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export type MediaRef = {
  id: string;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  caption?: string | null;
  mediaType?: string | null;
  productType?: string | null;
};

export function mediaKindLabel(m: { mediaType?: string | null; productType?: string | null }) {
  if (m.productType === "REELS") return "Reel";
  if (m.mediaType === "CAROUSEL_ALBUM") return "Carousel";
  if (m.mediaType === "VIDEO") return "Video";
  return "Post";
}

export type AutomationInput = {
  name: string;
  active: boolean;
  mediaScope: "ANY" | "SPECIFIC";
  media: MediaRef | null;
  keywordMode: "ANY" | "KEYWORDS";
  keywords: string[];
  keywordMatch: "WHOLE_WORD" | "CONTAINS";
  publicReplyEnabled: boolean;
  publicReplies: string[];
  openingMessage: string;
  openingButton: string;
  followGateEnabled: boolean;
  notFollowingMessage: string;
  notFollowingButton: string;
  maxFollowChecks: number;
  deliveryMessage: string;
  deliveryCardTitle: string;
  deliveryUrl: string;
  deliveryButton: string;
};

export const DEFAULT_AUTOMATION: AutomationInput = {
  name: "",
  active: false,
  mediaScope: "ANY",
  media: null,
  keywordMode: "KEYWORDS",
  keywords: [],
  keywordMatch: "WHOLE_WORD",
  publicReplyEnabled: true,
  publicReplies: ["Check your DMs! 📩", "Just sent it to you 💌", "Sent! Check your inbox ✨"],
  openingMessage: "Hey {first_name}! Thanks for commenting 🙌 Tap below and I'll send it over.",
  openingButton: "Send me the link",
  followGateEnabled: false,
  notFollowingMessage: "Looks like you're not following yet 👀 Follow this account, then tap the button below!",
  notFollowingButton: "I've followed ✅",
  maxFollowChecks: 3,
  deliveryMessage: "Here you go, {first_name}! 🎉",
  deliveryCardTitle: "Your link is ready",
  deliveryUrl: "",
  deliveryButton: "Open link",
};

// ── Normalisation ───────────────────────────────────────────────────────────

/** Trim, drop empties, dedupe keywords case-insensitively. Coerces unknown input into shape. */
export function normalizeAutomation(raw: unknown): AutomationInput {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const t = (v: unknown) => s(v).trim();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(t).filter(Boolean) : []);

  const seen = new Set<string>();
  const keywords = list(r.keywords).filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const m = r.media as Record<string, unknown> | null | undefined;
  const media: MediaRef | null =
    m && typeof m === "object" && typeof m.id === "string" && m.id
      ? {
          id: m.id,
          permalink: s(m.permalink) || null,
          thumbnailUrl: s(m.thumbnailUrl) || null,
          caption: s(m.caption) || null,
          mediaType: s(m.mediaType) || null,
          productType: s(m.productType) || null,
        }
      : null;

  // Strict: anything but an integer stays NaN so validation flags it identically on client and server.
  const checks = typeof r.maxFollowChecks === "number" && Number.isInteger(r.maxFollowChecks) ? r.maxFollowChecks : NaN;
  return {
    name: t(r.name),
    active: r.active === true,
    mediaScope: r.mediaScope === "SPECIFIC" ? "SPECIFIC" : "ANY",
    media,
    keywordMode: r.keywordMode === "ANY" ? "ANY" : "KEYWORDS",
    keywords,
    keywordMatch: r.keywordMatch === "CONTAINS" ? "CONTAINS" : "WHOLE_WORD",
    publicReplyEnabled: r.publicReplyEnabled === true,
    publicReplies: list(r.publicReplies),
    openingMessage: t(r.openingMessage),
    openingButton: t(r.openingButton),
    followGateEnabled: r.followGateEnabled === true,
    notFollowingMessage: t(r.notFollowingMessage),
    notFollowingButton: t(r.notFollowingButton),
    maxFollowChecks: checks,
    deliveryMessage: t(r.deliveryMessage),
    deliveryCardTitle: t(r.deliveryCardTitle),
    deliveryUrl: t(r.deliveryUrl),
    deliveryButton: t(r.deliveryButton),
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Field path → message. Paths: "name", "keywords", "publicReplies.2", "openingMessage", … */
export type Issues = Record<string, string>;
export type ValidationResult = { errors: Issues; warnings: Issues; ok: boolean };

type Kind = "dm" | "quickReply" | "button" | "cardTitle" | "comment";

/** Checks one text field against its Instagram limit, including the worst case with variables. */
function checkText(text: string, kind: Kind, label: string, path: string, errors: Issues, warnings: Issues) {
  const unknown = unknownVariables(text);
  if (unknown.length) {
    errors[path] = `Unknown variable ${unknown.map((u) => `{${u}}`).join(", ")}. Use {first_name} or {username}.`;
    return;
  }
  const m = measure(text);

  if (kind === "dm") {
    if (m.bytes > LIMITS.dmBytes) errors[path] = `${label} is ${m.bytes} bytes; Instagram's limit is ${LIMITS.dmBytes} (emoji count as 4).`;
    else if (m.maxBytes > LIMITS.dmBytes) warnings[path] = `${label} could reach ${m.maxBytes} bytes with a long name, over Instagram's ${LIMITS.dmBytes}.`;
    return;
  }
  if (kind === "comment") {
    if (m.chars > LIMITS.commentChars) errors[path] = `${label} is ${m.chars} characters; the limit is ${LIMITS.commentChars}.`;
    else if (m.maxChars > LIMITS.commentChars) warnings[path] = `${label} could exceed ${LIMITS.commentChars} characters with a long name.`;
    return;
  }
  const limit = kind === "cardTitle" ? LIMITS.cardTitleChars : kind === "quickReply" ? LIMITS.quickReplyChars : LIMITS.buttonTitleChars;
  if (m.chars > limit) {
    // Quick replies are truncated by Meta (still sends); card titles/buttons are rejected.
    (kind === "quickReply" ? warnings : errors)[path] =
      kind === "quickReply"
        ? `${label} is ${m.chars} characters; Instagram cuts it off after ${limit}.`
        : `${label} is ${m.chars} characters; the limit is ${limit}.`;
  } else if (m.maxChars > limit) {
    warnings[path] = `${label} could exceed ${limit} characters with a long name.`;
  }
}

/** Instagram's button card (button visible on web + mobile) holds ≤ 640 chars; longer messages get a mobile-only quick reply. */
export const BUTTON_CARD_MAX_CHARS = 640;

function warnIfTooLongForButtonCard(text: string, path: string, errors: Issues, warnings: Issues) {
  if (errors[path] || warnings[path]) return;
  const m = measure(text);
  if (m.maxChars > BUTTON_CARD_MAX_CHARS) {
    warnings[path] =
      `Over ${BUTTON_CARD_MAX_CHARS} characters${m.chars > BUTTON_CARD_MAX_CHARS ? "" : " with a long name"}: the button will only show in the Instagram mobile app, not on the web. Shorten it to keep the button everywhere.`;
  }
}

function required(value: string, label: string, path: string, errors: Issues) {
  if (!value.trim()) {
    errors[path] = `${label} is required.`;
    return false;
  }
  return true;
}

export function validateAutomation(a: AutomationInput): ValidationResult {
  const errors: Issues = {};
  const warnings: Issues = {};

  // Basics
  if (required(a.name, "Name", "name", errors) && charLength(a.name) > LIMITS.nameChars) {
    errors.name = `Name must be at most ${LIMITS.nameChars} characters.`;
  }

  // Trigger
  if (a.mediaScope === "SPECIFIC" && !a.media) errors.media = "Pick a post or reel, or choose “Any post”.";

  if (a.keywordMode === "KEYWORDS") {
    if (!a.keywords.length) errors.keywords = "Add at least one keyword, or choose “Any comment”.";
    else if (a.keywords.length > LIMITS.maxKeywords) errors.keywords = `At most ${LIMITS.maxKeywords} keywords.`;
    else {
      const long = a.keywords.find((k) => charLength(k) > LIMITS.keywordChars);
      if (long) errors.keywords = `Keyword “${long.slice(0, 20)}…” is longer than ${LIMITS.keywordChars} characters.`;
      const short = a.keywords.find((k) => a.keywordMatch === "CONTAINS" && charLength(k) < 3);
      if (!long && short) {
        warnings.keywords = `“${short}” is very short; with “contains” matching it will trigger on many unrelated comments.`;
      }
    }
  } else if (a.mediaScope === "ANY") {
    warnings.keywords = "Any comment on any post will trigger this automation.";
  }

  // Public reply
  if (a.publicReplyEnabled) {
    if (!a.publicReplies.length) errors.publicReplies = "Add at least one reply variation, or turn public replies off.";
    else if (a.publicReplies.length > LIMITS.maxPublicReplies) errors.publicReplies = `At most ${LIMITS.maxPublicReplies} variations.`;
    else {
      a.publicReplies.forEach((r, i) => checkText(r, "comment", `Variation ${i + 1}`, `publicReplies.${i}`, errors, warnings));
      if (a.publicReplies.length === 1 && !errors["publicReplies.0"]) {
        warnings.publicReplies = "Add a few variations so identical replies don't look spammy.";
      }
    }
  }

  // Opening DM
  if (required(a.openingMessage, "Opening message", "openingMessage", errors)) {
    checkText(a.openingMessage, "dm", "Opening message", "openingMessage", errors, warnings);
    warnIfTooLongForButtonCard(a.openingMessage, "openingMessage", errors, warnings);
  }
  if (required(a.openingButton, "Button label", "openingButton", errors)) {
    checkText(a.openingButton, "quickReply", "Button label", "openingButton", errors, warnings);
  }

  // Follow gate
  if (a.followGateEnabled) {
    if (required(a.notFollowingMessage, "“Not following” message", "notFollowingMessage", errors)) {
      checkText(a.notFollowingMessage, "dm", "“Not following” message", "notFollowingMessage", errors, warnings);
      warnIfTooLongForButtonCard(a.notFollowingMessage, "notFollowingMessage", errors, warnings);
    }
    if (required(a.notFollowingButton, "Button label", "notFollowingButton", errors)) {
      checkText(a.notFollowingButton, "quickReply", "Button label", "notFollowingButton", errors, warnings);
    }
    if (!Number.isInteger(a.maxFollowChecks) || a.maxFollowChecks < LIMITS.minFollowChecks || a.maxFollowChecks > LIMITS.maxFollowChecks) {
      errors.maxFollowChecks = `Choose between ${LIMITS.minFollowChecks} and ${LIMITS.maxFollowChecks}.`;
    }
  }

  // Delivery
  if (required(a.deliveryMessage, "Delivery message", "deliveryMessage", errors)) {
    checkText(a.deliveryMessage, "dm", "Delivery message", "deliveryMessage", errors, warnings);
  }
  if (required(a.deliveryCardTitle, "Card title", "deliveryCardTitle", errors)) {
    checkText(a.deliveryCardTitle, "cardTitle", "Card title", "deliveryCardTitle", errors, warnings);
  }
  if (required(a.deliveryButton, "Button label", "deliveryButton", errors)) {
    checkText(a.deliveryButton, "button", "Button label", "deliveryButton", errors, warnings);
  }
  if (required(a.deliveryUrl, "Link URL", "deliveryUrl", errors)) {
    let url: URL | null = null;
    try {
      url = new URL(a.deliveryUrl);
    } catch {
      /* invalid */
    }
    if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) {
      errors.deliveryUrl = "Enter a full URL, e.g. https://example.com/guide";
    } else if (a.deliveryUrl.length > LIMITS.urlChars) {
      errors.deliveryUrl = `URL must be at most ${LIMITS.urlChars} characters.`;
    } else if (url.protocol === "http:") {
      warnings.deliveryUrl = "Use https:// so the link opens without a security warning.";
    }
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 };
}

// ── Keyword matching (used by the editor's tester now, and by the flow engine later) ──

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns the first keyword the comment matches, or null. Case-insensitive, Unicode-aware. */
export function matchKeyword(
  comment: string,
  keywords: string[],
  mode: AutomationInput["keywordMatch"],
): string | null {
  const text = comment.toLocaleLowerCase();
  for (const k of keywords) {
    const kw = k.toLocaleLowerCase().trim();
    if (!kw) continue;
    if (mode === "CONTAINS" ? text.includes(kw) : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(kw)}(?![\\p{L}\\p{N}_])`, "u").test(text)) {
      return k;
    }
  }
  return null;
}
