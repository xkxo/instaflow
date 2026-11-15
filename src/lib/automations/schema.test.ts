import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_AUTOMATION,
  matchKeyword,
  measure,
  normalizeAutomation,
  renderTemplate,
  unknownVariables,
  validateAutomation,
  type AutomationInput,
} from "./schema";

describe("matchKeyword", () => {
  it("is case-insensitive", () => {
    assert.equal(matchKeyword("Send me the LINK please", ["link"], "WHOLE_WORD"), "link");
    assert.equal(matchKeyword("send me the link", ["LINK"], "WHOLE_WORD"), "LINK");
  });

  it("whole word: ignores matches inside other words", () => {
    assert.equal(matchKeyword("my linkedin profile", ["link"], "WHOLE_WORD"), null);
    assert.equal(matchKeyword("unlinked", ["link"], "WHOLE_WORD"), null);
  });

  it("whole word: punctuation, emoji and line breaks are boundaries", () => {
    for (const c of ["link!", "(link)", "🔥link🔥", "link?", "LINK.", "please\nlink", "#link"]) {
      assert.equal(matchKeyword(c, ["link"], "WHOLE_WORD"), "link", c);
    }
  });

  it("contains: matches anywhere", () => {
    assert.equal(matchKeyword("my linkedin profile", ["link"], "CONTAINS"), "link");
    assert.equal(matchKeyword("nothing here", ["link"], "CONTAINS"), null);
  });

  it("supports multi-word keywords", () => {
    assert.equal(matchKeyword("Can I get the FREE guide?", ["free guide"], "WHOLE_WORD"), "free guide");
    assert.equal(matchKeyword("free guidebook", ["free guide"], "WHOLE_WORD"), null);
  });

  it("treats non-Latin letters as word characters", () => {
    assert.equal(matchKeyword("preço?", ["preço"], "WHOLE_WORD"), "preço");
    assert.equal(matchKeyword("précio", ["cio"], "WHOLE_WORD"), null);
    assert.equal(matchKeyword("Ссылка пожалуйста", ["ссылка"], "WHOLE_WORD"), "ссылка");
  });

  it("treats regex special characters literally", () => {
    assert.equal(matchKeyword("price $$$ ok", ["$$$"], "CONTAINS"), "$$$");
    assert.equal(matchKeyword("a.b", ["a*b"], "WHOLE_WORD"), null);
    assert.equal(matchKeyword("c++ please", ["c++"], "CONTAINS"), "c++");
  });

  it("returns the first matching keyword in list order and skips blanks", () => {
    assert.equal(matchKeyword("guide and link", ["link", "guide"], "WHOLE_WORD"), "link");
    assert.equal(matchKeyword("link", ["  ", "link"], "WHOLE_WORD"), "link");
    assert.equal(matchKeyword("anything", [], "WHOLE_WORD"), null);
  });
});

describe("templates", () => {
  it("renders known variables and leaves unknown ones", () => {
    assert.equal(renderTemplate("Hi {first_name} (@{username}) {nope}", { first_name: "Jess", username: "jp" }), "Hi Jess (@jp) {nope}");
    assert.deepEqual(unknownVariables("{nope} {first_name} {x}"), ["nope", "x"]);
  });

  it("measures bytes (emoji = 4) and the worst case with variables", () => {
    const m = measure("Hi {first_name} 👋");
    assert.equal(m.chars, 17);
    assert.equal(m.bytes, 20);
    assert.equal(m.hasVariables, true);
    assert.ok(m.maxBytes > m.bytes);
  });
});

describe("validateAutomation", () => {
  const valid = (patch: Partial<AutomationInput> = {}) =>
    validateAutomation(normalizeAutomation({ ...DEFAULT_AUTOMATION, name: "Guide", keywords: ["link"], deliveryUrl: "https://example.com", ...patch }));

  it("accepts the defaults once name, keyword and URL are set", () => assert.equal(valid().ok, true));
  it("rejects DMs over 1000 bytes (not characters)", () => {
    assert.equal(valid({ openingMessage: "a".repeat(1000) }).ok, true);
    assert.equal(valid({ openingMessage: "🎉".repeat(260) }).ok, false); // 260 chars, 1040 bytes
  });
  it("warns (doesn't block) when a quick-reply label will be truncated", () => {
    const r = valid({ openingButton: "Send me the link right now please" });
    assert.equal(r.ok, true);
    assert.match(r.warnings.openingButton ?? "", /cuts it off/);
  });
  it("rejects unknown variables", () => assert.match(valid({ deliveryMessage: "Hi {last_name}" }).errors.deliveryMessage ?? "", /Unknown variable/));
  it("requires a post for specific-post triggers", () => assert.ok(valid({ mediaScope: "SPECIFIC" }).errors.media));
  it("validates follow-gate re-check range", () => {
    assert.ok(valid({ followGateEnabled: true, maxFollowChecks: 0 }).errors.maxFollowChecks);
    assert.ok(valid({ followGateEnabled: true, maxFollowChecks: 11 }).errors.maxFollowChecks);
    assert.equal(valid({ followGateEnabled: true, maxFollowChecks: 3 }).ok, true);
  });
  it("rejects non-http URLs", () => assert.ok(valid({ deliveryUrl: "javascript:alert(1)" }).errors.deliveryUrl));
});
