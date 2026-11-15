import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backoffMs,
  decodePayload,
  deliveryCard,
  deliveryText,
  encodePayload,
  humanDelayMs,
  isRetryable,
  needsFollowCheck,
  notFollowingMessage,
  openingMessage,
  pickAutomation,
  pickPublicReply,
  privateReplyExpired,
  quickReplyTitle,
  tapForStep,
  templateValues,
  transition,
  type Action,
  type MatchableAutomation,
  type RunSnapshot,
  type Tap,
} from "./machine";

// ── helpers ─────────────────────────────────────────────────────────────────

const run = (patch: Partial<RunSnapshot> = {}): RunSnapshot => ({
  step: "AWAITING_OPT_IN",
  status: "ACTIVE",
  followChecks: 0,
  followGateEnabled: true,
  maxFollowChecks: 3,
  ...patch,
});

/**
 * Walk a whole conversation: the user taps whatever the run waits for; follow checks return
 * `followsAfter` falses then true (null = never). Returns the final state and messages sent.
 */
function walk(start: RunSnapshot, followsAfter: number | null, maxTaps = 50) {
  let state = { ...start };
  const sent: Action[] = [];
  let checks = 0;
  for (let i = 0; i < maxTaps && state.status === "ACTIVE"; i++) {
    const tap = tapForStep(state.step);
    if (!tap) break;
    let follows: boolean | null = null;
    if (needsFollowCheck(state, tap)) follows = followsAfter !== null && checks++ >= followsAfter;
    const t = transition(state, tap, follows);
    if (t.kind === "ignore") throw new Error(`unexpected ignore: ${t.reason}`);
    assert.deepEqual(t.expect, { step: state.step, followChecks: state.followChecks }, "CAS guard must match current state");
    sent.push(...t.actions);
    state = { ...state, ...t.next };
    if (t.actions.includes("SEND_DELIVERY")) state = { ...state, step: "DELIVERED", status: "COMPLETED" }; // delivery jobs finish it
  }
  return { state, sent };
}

// ── transitions ─────────────────────────────────────────────────────────────

describe("transition: full conversations", () => {
  it("gate off: opt-in → delivery, no follow check", () => {
    const start = run({ followGateEnabled: false });
    assert.equal(needsFollowCheck(start, "OPT_IN"), false);
    const { state, sent } = walk(start, null);
    assert.equal(state.status, "COMPLETED");
    assert.deepEqual(sent, ["SEND_DELIVERY"]);
  });

  it("already following: opt-in → delivery", () => {
    const { state, sent } = walk(run(), 0);
    assert.equal(state.status, "COMPLETED");
    assert.deepEqual(sent, ["SEND_DELIVERY"]);
    assert.equal(state.followChecks, 0);
  });

  it("follows after the first reminder", () => {
    const { state, sent } = walk(run(), 1);
    assert.equal(state.status, "COMPLETED");
    assert.deepEqual(sent, ["SEND_NOT_FOLLOWING", "SEND_DELIVERY"]);
    assert.equal(state.followChecks, 1);
  });

  it("follows on the last allowed re-check", () => {
    const { state, sent } = walk(run({ maxFollowChecks: 3 }), 3);
    assert.equal(state.status, "COMPLETED");
    assert.deepEqual(sent, ["SEND_NOT_FOLLOWING", "SEND_NOT_FOLLOWING", "SEND_NOT_FOLLOWING", "SEND_DELIVERY"]);
  });

  for (const max of [1, 2, 3, 5]) {
    it(`never follows (max ${max} re-checks): ${max} gate messages, then ABANDONED without delivery`, () => {
      const { state, sent } = walk(run({ maxFollowChecks: max }), null);
      assert.equal(state.status, "ABANDONED");
      assert.equal(sent.filter((a) => a === "SEND_NOT_FOLLOWING").length, max);
      assert.ok(!sent.includes("SEND_DELIVERY"));
      assert.equal(state.followChecks, max + 1); // initial check + max re-checks
    });
  }
});

describe("transition: individual steps", () => {
  it("first not-following marks the follow gate and moves to AWAITING_FOLLOW", () => {
    const t = transition(run(), "OPT_IN", false);
    assert.equal(t.kind, "advance");
    if (t.kind !== "advance") return;
    assert.deepEqual(t.next, { step: "AWAITING_FOLLOW", status: "ACTIVE", followChecks: 1 });
    assert.equal(t.firstGate, true);
    assert.equal(t.optedIn, true);
    assert.deepEqual(t.actions, ["SEND_NOT_FOLLOWING"]);
  });

  it("a later not-following doesn't re-mark the gate", () => {
    const t = transition(run({ step: "AWAITING_FOLLOW", followChecks: 1 }), "FOLLOWED", false);
    assert.equal(t.kind === "advance" && t.firstGate, false);
  });

  it("gate turned off mid-run: “I've followed” delivers without a check", () => {
    const r = run({ step: "AWAITING_FOLLOW", followChecks: 1, followGateEnabled: false });
    assert.equal(needsFollowCheck(r, "FOLLOWED"), false);
    const t = transition(r, "FOLLOWED", null);
    assert.equal(t.kind === "advance" && t.actions[0], "SEND_DELIVERY");
  });

  it("requires a follow result when the gate is on", () => {
    assert.throws(() => transition(run(), "OPT_IN", null), /Follow status is required/);
  });
});

describe("transition: stale, duplicate and out-of-order taps are ignored", () => {
  const cases: [string, Partial<RunSnapshot>, Tap][] = [
    ["opt-in tapped twice (already awaiting follow)", { step: "AWAITING_FOLLOW", followChecks: 1 }, "OPT_IN"],
    ["opt-in tapped after delivery", { step: "DELIVERED", status: "COMPLETED" }, "OPT_IN"],
    ["“I've followed” before opting in", { step: "AWAITING_OPT_IN" }, "FOLLOWED"],
    ["tap while delivering", { step: "DELIVERING" }, "FOLLOWED"],
    ["tap before the opening DM was sent", { step: "TRIGGERED" }, "OPT_IN"],
    ["tap on an abandoned run", { step: "AWAITING_FOLLOW", status: "ABANDONED" }, "FOLLOWED"],
    ["tap on a failed run", { status: "FAILED" }, "OPT_IN"],
  ];
  for (const [name, patch, tap] of cases) {
    it(name, () => {
      const r = run(patch);
      assert.equal(needsFollowCheck(r, tap), false, "must not call the API for an ignored tap");
      assert.equal(transition(r, tap, false).kind, "ignore");
    });
  }
});

// ── payloads ────────────────────────────────────────────────────────────────

describe("quick-reply payloads", () => {
  it("round-trips run ID and tap", () => {
    for (const tap of ["OPT_IN", "FOLLOWED"] as const) {
      assert.deepEqual(decodePayload(encodePayload("cmabc123xyz", tap)), { runId: "cmabc123xyz", tap });
    }
  });
  it("fits Instagram's 1000-char payload limit", () => assert.ok(encodePayload("c".repeat(64), "FOLLOWED").length < 1000));
  it("rejects foreign or malformed payloads", () => {
    for (const p of [null, "", "PRICE_LIST", "IF1:", "IF1:abc12345", "IF1:abc12345:NOPE", "IF2:abc12345:OPT_IN", "IF1:abc12345:OPT_IN:x", "IF1:../etc:OPT_IN", "IF1:a b c d e:OPT_IN"]) {
      assert.equal(decodePayload(p), null, String(p));
    }
  });
  it("maps text replies to the tap the run is waiting for", () => {
    assert.equal(tapForStep("AWAITING_OPT_IN"), "OPT_IN");
    assert.equal(tapForStep("AWAITING_FOLLOW"), "FOLLOWED");
    assert.equal(tapForStep("DELIVERED"), null);
    assert.equal(tapForStep("TRIGGERED"), null);
  });
});

// ── automation matching ─────────────────────────────────────────────────────

describe("pickAutomation", () => {
  const t0 = new Date("2026-01-01");
  const auto = (id: string, p: Partial<MatchableAutomation> = {}): MatchableAutomation => ({
    id,
    active: true,
    mediaScope: "ANY",
    mediaId: null,
    keywordMode: "KEYWORDS",
    keywords: ["link"],
    keywordMatch: "WHOLE_WORD",
    updatedAt: t0,
    ...p,
  });

  it("matches post + keyword", () => {
    assert.equal(pickAutomation({ text: "link pls", mediaId: "M1" }, [auto("a")])?.automation.id, "a");
    assert.equal(pickAutomation({ text: "nope", mediaId: "M1" }, [auto("a")]), null);
  });
  it("skips paused automations", () => {
    assert.equal(pickAutomation({ text: "link", mediaId: "M1" }, [auto("a", { active: false })]), null);
  });
  it("specific-post automations only fire on their post", () => {
    const a = auto("a", { mediaScope: "SPECIFIC", mediaId: "M1" });
    assert.equal(pickAutomation({ text: "link", mediaId: "M2" }, [a]), null);
    assert.equal(pickAutomation({ text: "link", mediaId: "M1" }, [a])?.automation.id, "a");
  });
  it("prefers specific post > any post, keywords > any comment, then most recently edited", () => {
    const anyAny = auto("anyAny", { keywordMode: "ANY", keywords: [] });
    const anyKw = auto("anyKw");
    const specAny = auto("specAny", { mediaScope: "SPECIFIC", mediaId: "M1", keywordMode: "ANY", keywords: [] });
    const specKw = auto("specKw", { mediaScope: "SPECIFIC", mediaId: "M1" });
    const c = { text: "link please", mediaId: "M1" };
    assert.equal(pickAutomation(c, [anyAny, anyKw, specAny, specKw])?.automation.id, "specKw");
    assert.equal(pickAutomation(c, [anyAny, anyKw, specAny])?.automation.id, "specAny");
    assert.equal(pickAutomation(c, [anyAny, anyKw])?.automation.id, "anyKw");
    const newer = auto("newer", { updatedAt: new Date("2026-06-01") });
    assert.equal(pickAutomation(c, [anyKw, newer])?.automation.id, "newer");
  });
  it("reports the matched keyword (null for any comment)", () => {
    assert.equal(pickAutomation({ text: "GUIDE!", mediaId: null }, [auto("a", { keywords: ["link", "guide"] })])?.keyword, "guide");
    assert.equal(pickAutomation({ text: "hi", mediaId: null }, [auto("a", { keywordMode: "ANY", keywords: [] })])?.keyword, null);
  });
});

// ── messages ────────────────────────────────────────────────────────────────

describe("messages", () => {
  const a = {
    openingMessage: "Hey {first_name}! Tap below",
    openingButton: "Send me the link please now",
    notFollowingMessage: "Follow first, @{username}",
    notFollowingButton: "I've followed ✅",
    deliveryMessage: "Here you go {first_name}",
    deliveryCardTitle: "Your guide",
    deliveryUrl: "https://example.com/g",
    deliveryButton: "Open link",
    publicReplies: ["Check DMs {first_name}", "  "],
  };
  const jess = { username: "jess.p", name: "Jess Smith" };

  it("uses the first name, falling back to “there” before profile consent", () => {
    assert.deepEqual(templateValues(jess), { first_name: "Jess", username: "jess.p" });
    assert.deepEqual(templateValues({ username: null, name: null }), { first_name: "there", username: "there" });
  });

  it("opening DM: rendered text + one quick reply carrying the run payload, title ≤ 20 chars", () => {
    const m = openingMessage(a, jess, "run12345");
    assert.ok("text" in m);
    if (!("text" in m)) return;
    assert.equal(m.text, "Hey Jess! Tap below");
    assert.equal(m.quick_replies?.length, 1);
    assert.equal(m.quick_replies![0].content_type, "text");
    assert.equal(m.quick_replies![0].payload, "IF1:run12345:OPT_IN");
    assert.ok([...m.quick_replies![0].title].length <= 20);
  });

  it("not-following message carries the FOLLOWED payload", () => {
    const m = notFollowingMessage(a, jess, "run12345");
    assert.ok("text" in m && m.text === "Follow first, @jess.p" && m.quick_replies?.[0].payload === "IF1:run12345:FOLLOWED");
  });

  it("delivery: text, then a generic-template card with a web_url button", () => {
    assert.deepEqual(deliveryText(a, jess), { text: "Here you go Jess" });
    assert.deepEqual(deliveryCard(a, jess), {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{ title: "Your guide", buttons: [{ type: "web_url", url: "https://example.com/g", title: "Open link" }] }],
        },
      },
    });
  });

  it("public reply picks a non-blank variation", () => {
    assert.equal(pickPublicReply(a, jess, () => 0.99), "Check DMs Jess");
    assert.equal(pickPublicReply({ publicReplies: [" "] }, jess), null);
  });

  it("quick-reply titles are truncated cleanly (by characters, not bytes)", () => {
    assert.equal(quickReplyTitle("short"), "short");
    assert.equal([...quickReplyTitle("🎉".repeat(30))].length, 20);
  });
});

// ── timing & retries ────────────────────────────────────────────────────────

describe("timing and retries", () => {
  it("human delay is 2–6 seconds", () => {
    assert.equal(humanDelayMs(() => 0), 2000);
    assert.equal(humanDelayMs(() => 0.999999), 6000);
    for (let i = 0; i < 200; i++) {
      const d = humanDelayMs();
      assert.ok(d >= 2000 && d <= 6000);
    }
  });

  it("private replies expire after 7 days", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    assert.equal(privateReplyExpired(new Date(now - 6.9 * 864e5), now), false);
    assert.equal(privateReplyExpired(new Date(now - 7.1 * 864e5), now), true);
  });

  it("retries 5xx, network errors, rate limits (4, 17, 32, 613, 80002) and Meta temporary errors", () => {
    for (const code of [4, 17, 32, 613, 80002, 1, 2]) assert.equal(isRetryable({ httpStatus: 400, code }), true, `code ${code}`);
    assert.equal(isRetryable({ httpStatus: 500 }), true);
    assert.equal(isRetryable({ httpStatus: 503, code: 100 }), true);
    assert.equal(isRetryable({ httpStatus: 0 }), true);
  });

  it("doesn't retry permanent errors (bad token, permissions, invalid params)", () => {
    for (const code of [190, 10, 200, 100, 368]) assert.equal(isRetryable({ httpStatus: 400, code }), false, `code ${code}`);
  });

  it("backs off exponentially with jitter, longer for rate limits, capped at 1 h", () => {
    const mid = () => 0.5; // no jitter
    assert.deepEqual([1, 2, 3, 4].map((n) => backoffMs(n, { httpStatus: 500 }, mid)), [15_000, 30_000, 60_000, 120_000]);
    assert.equal(backoffMs(1, { httpStatus: 400, code: 4 }, mid), 60_000);
    assert.equal(backoffMs(2, { httpStatus: 400, code: 613 }, mid), 120_000);
    assert.equal(backoffMs(20, { httpStatus: 500 }, mid), 3_600_000);
    const lo = backoffMs(1, { httpStatus: 500 }, () => 0);
    const hi = backoffMs(1, { httpStatus: 500 }, () => 1);
    assert.ok(lo === 12_000 && hi === 18_000, `${lo} ${hi}`);
  });
});
