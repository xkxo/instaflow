"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Trash2, XCircle } from "lucide-react";
import {
  LIMITS,
  matchKeyword,
  mediaKindLabel,
  normalizeAutomation,
  validateAutomation,
  type AutomationInput,
  type ValidationResult,
} from "@/lib/automations/schema";
import { deleteAutomationAction, saveAutomationAction } from "../actions";
import { SimulateButton } from "../simulate-button";
import { KeywordInput, Label, Section, Segmented, TemplateField, TextField, Toggle, VariationsField, Issue } from "./fields";
import { MediaPicker, MediaThumb } from "./media-picker";
import { PhonePreview } from "./phone-preview";

export function AutomationEditor({
  id,
  initial,
  ownUsername,
  instagramConnected,
}: {
  id: string | null;
  initial: AutomationInput;
  ownUsername: string;
  instagramConnected: boolean;
}) {
  const [a, setA] = useState<AutomationInput>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverIssues, setServerIssues] = useState<ValidationResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testComment, setTestComment] = useState("");
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof AutomationInput>(key: K, value: AutomationInput[K]) => {
    setA((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setServerIssues(null);
  };

  // Validate exactly what the server will validate (normalised input).
  const validation = useMemo(() => validateAutomation(normalizeAutomation(a)), [a]);
  const issues = serverIssues ?? validation;
  const visible = (path: string) => submitted || touched.has(path.split(".")[0]);
  const err = (path: string) => (visible(path) ? issues.errors[path] : undefined);
  const warn = (path: string) => issues.warnings[path];
  const errorCount = Object.keys(issues.errors).length;

  // Warn before leaving with unsaved changes.
  const dirty = useMemo(() => JSON.stringify(a) !== JSON.stringify(initial), [a, initial]);
  useEffect(() => {
    if (!dirty || pending) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending]);

  const save = () => {
    setSubmitted(true);
    setServerError(null);
    if (!validation.ok) {
      requestAnimationFrame(() => document.querySelector("[aria-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    startTransition(async () => {
      const res = await saveAutomationAction(id, a);
      if (res && "validation" in res) setServerIssues(res.validation);
      else if (res && "error" in res) setServerError(res.error);
    });
  };

  const remove = () => {
    if (!id || !confirm(`Delete “${a.name || "this automation"}”? Its run history will be deleted too.`)) return;
    startTransition(() => deleteAutomationAction(id));
  };

  const matched = testComment.trim()
    ? a.keywordMode === "ANY"
      ? "any"
      : matchKeyword(testComment, a.keywords, a.keywordMatch)
    : null;

  return (
    <>
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/automations" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Automations
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {submitted && errorCount > 0 && (
            <span className="text-sm text-red-400">
              Fix {errorCount} {errorCount === 1 ? "error" : "errors"} to save
            </span>
          )}
          {id && (
            <span title={dirty ? "Simulates the saved version. Save first to test your changes." : undefined}>
              <SimulateButton
                automationId={id}
                defaultComment={initial.keywordMode === "KEYWORDS" && initial.keywords[0] ? `${initial.keywords[0]} please!` : "Love this!"}
                followGate={initial.followGateEnabled}
              />
            </span>
          )}
          {id && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-60"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {id ? "Save changes" : "Create automation"}
          </button>
        </div>
      </div>

      {serverError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <XCircle className="mt-0.5 size-4 shrink-0" /> {serverError}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          {/* Basics */}
          <Section
            title={id ? "Edit automation" : "New automation"}
            aside={
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                {a.active ? "Active" : "Paused"}
                <Toggle checked={a.active} onChange={(v) => set("active", v)} label="Active" />
              </label>
            }
          >
            <TextField id="name" label="Name" value={a.name} onChange={(v) => set("name", v)} placeholder="e.g. Free guide — reel 12 Nov" error={err("name")} />
          </Section>

          {/* Trigger */}
          <Section step={1} title="Trigger" description="When someone comments on…">
            <Segmented
              label="Which posts"
              value={a.mediaScope}
              onChange={(v) => set("mediaScope", v)}
              options={[
                { value: "ANY", label: "Any post or reel" },
                { value: "SPECIFIC", label: "A specific post" },
              ]}
            />
            {a.mediaScope === "SPECIFIC" && (
              <div>
                {a.media ? (
                  <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                    <MediaThumb media={a.media} className="size-16 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="text-xs text-zinc-500">{mediaKindLabel(a.media)}</p>
                      <p className="line-clamp-2 text-zinc-200">{a.media.caption || "No caption"}</p>
                      {a.media.permalink && (
                        <a href={a.media.permalink} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                          View on Instagram <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    <button type="button" onClick={() => setPickerOpen(true)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-invalid={!!err("media")}
                    disabled={!instagramConnected}
                    onClick={() => setPickerOpen(true)}
                    className="flex w-full items-center justify-center rounded-lg border border-dashed border-zinc-700 py-6 text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {instagramConnected ? "Choose from your recent posts" : "Connect Instagram in Settings to pick a post"}
                  </button>
                )}
                <Issue error={err("media")} />
              </div>
            )}

            <div>
              <Label>Comment contains</Label>
              <Segmented
                label="Keyword mode"
                value={a.keywordMode}
                onChange={(v) => set("keywordMode", v)}
                options={[
                  { value: "KEYWORDS", label: "Specific keywords" },
                  { value: "ANY", label: "Any comment" },
                ]}
              />
            </div>
            {a.keywordMode === "KEYWORDS" ? (
              <>
                <KeywordInput value={a.keywords} onChange={(v) => set("keywords", v)} error={err("keywords")} warning={warn("keywords")} />
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    label="Match"
                    value={a.keywordMatch}
                    onChange={(v) => set("keywordMatch", v)}
                    options={[
                      { value: "WHOLE_WORD", label: "Whole word" },
                      { value: "CONTAINS", label: "Contains" },
                    ]}
                  />
                  <span className="text-xs text-zinc-500">
                    {a.keywordMatch === "WHOLE_WORD" ? "“link” matches “send the link!” but not “linkedin”." : "“link” also matches “linkedin”."} Case-insensitive.
                  </span>
                </div>
              </>
            ) : (
              <Issue warning={warn("keywords")} />
            )}

            <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
              <Label htmlFor="test-comment">Test a comment</Label>
              <input
                id="test-comment"
                value={testComment}
                onChange={(e) => setTestComment(e.target.value)}
                placeholder="Type a comment to see if it would trigger…"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
              {testComment.trim() && (
                <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${matched ? "text-emerald-400" : "text-zinc-500"}`}>
                  {matched ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {matched === "any" ? "Triggers (any comment)" : matched ? `Triggers — matched “${matched}”` : "Would not trigger"}
                </p>
              )}
            </div>
          </Section>

          {/* Public reply */}
          <Section
            step={2}
            title="Public reply"
            description="Reply under the comment. One variation is picked at random."
            aside={<Toggle checked={a.publicReplyEnabled} onChange={(v) => set("publicReplyEnabled", v)} label="Public reply" />}
          >
            {a.publicReplyEnabled ? (
              <VariationsField
                values={a.publicReplies}
                onChange={(v) => set("publicReplies", v)}
                errors={submitted || touched.has("publicReplies") ? issues.errors : {}}
                warnings={issues.warnings}
                listError={err("publicReplies")}
                listWarning={warn("publicReplies")}
              />
            ) : (
              <p className="text-sm text-zinc-500">Off. Only the DM will be sent.</p>
            )}
          </Section>

          {/* Opening DM */}
          <Section step={3} title="Opening DM" description="Sent as a private reply to the comment, with one quick-reply button.">
            <TemplateField id="openingMessage" label="Message" kind="dm" multiline value={a.openingMessage} onChange={(v) => set("openingMessage", v)} error={err("openingMessage")} warning={warn("openingMessage")} />
            <TemplateField id="openingButton" label="Button label" kind="quickReply" value={a.openingButton} onChange={(v) => set("openingButton", v)} error={err("openingButton")} warning={warn("openingButton")} />
          </Section>

          {/* Follow gate */}
          <Section
            step={4}
            title="Follow gate"
            description="Only deliver the link to people who follow you."
            aside={<Toggle checked={a.followGateEnabled} onChange={(v) => set("followGateEnabled", v)} label="Follow gate" />}
          >
            {a.followGateEnabled ? (
              <>
                <TemplateField id="notFollowingMessage" label="“Not following” message" kind="dm" multiline value={a.notFollowingMessage} onChange={(v) => set("notFollowingMessage", v)} error={err("notFollowingMessage")} warning={warn("notFollowingMessage")} />
                <TemplateField id="notFollowingButton" label="Button label" kind="quickReply" value={a.notFollowingButton} onChange={(v) => set("notFollowingButton", v)} error={err("notFollowingButton")} warning={warn("notFollowingButton")} />
                <div className="max-w-48">
                  <Label htmlFor="maxFollowChecks">Max re-checks before giving up</Label>
                  <input
                    id="maxFollowChecks"
                    type="number"
                    min={LIMITS.minFollowChecks}
                    max={LIMITS.maxFollowChecks}
                    value={Number.isNaN(a.maxFollowChecks) ? "" : a.maxFollowChecks}
                    aria-invalid={!!err("maxFollowChecks")}
                    onChange={(e) => set("maxFollowChecks", e.target.value === "" ? NaN : Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                  />
                  <Issue error={err("maxFollowChecks")} />
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Off. Everyone who taps the button gets the link.</p>
            )}
          </Section>

          {/* Delivery */}
          <Section step={5} title="Delivery" description="A message, then a card with a link button.">
            <TemplateField id="deliveryMessage" label="Message" kind="dm" multiline value={a.deliveryMessage} onChange={(v) => set("deliveryMessage", v)} error={err("deliveryMessage")} warning={warn("deliveryMessage")} />
            <TemplateField id="deliveryCardTitle" label="Card title" kind="cardTitle" value={a.deliveryCardTitle} onChange={(v) => set("deliveryCardTitle", v)} error={err("deliveryCardTitle")} warning={warn("deliveryCardTitle")} />
            <TextField id="deliveryUrl" label="Link URL" type="url" value={a.deliveryUrl} onChange={(v) => set("deliveryUrl", v)} placeholder="https://example.com/free-guide" error={err("deliveryUrl")} warning={warn("deliveryUrl")} />
            <TemplateField id="deliveryButton" label="Button label" kind="button" value={a.deliveryButton} onChange={(v) => set("deliveryButton", v)} error={err("deliveryButton")} warning={warn("deliveryButton")} variables={false} />
          </Section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <PhonePreview a={a} ownUsername={ownUsername} />
        </div>
      </div>

      <MediaPicker
        open={pickerOpen}
        selectedId={a.media?.id}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          set("media", m);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
