"use client";

import { useState } from "react";
import { ChevronLeft, ExternalLink, Heart, Info, MessageCircle, RefreshCw } from "lucide-react";
import { renderTemplate, VARIABLES, type AutomationInput } from "@/lib/automations/schema";
import { MediaThumb } from "./media-picker";

const SAMPLE = { first_name: VARIABLES.first_name.sample, username: VARIABLES.username.sample };
const fill = (t: string) => renderTemplate(t, SAMPLE);

function Avatar({ label, me }: { label: string; me?: boolean }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold uppercase text-white ${
        me ? "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400" : "bg-zinc-600"
      }`}
    >
      {label.charAt(0)}
    </span>
  );
}

/** Incoming = from the business (left, grey); outgoing = the commenter (right, purple). */
function Bubble({ from, children, muted }: { from: "business" | "user"; children: React.ReactNode; muted?: boolean }) {
  const business = from === "business";
  return (
    <div className={`flex ${business ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug ${
          business ? "rounded-bl-md bg-zinc-800 text-zinc-100" : "rounded-br-md bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white"
        } ${muted ? "opacity-60" : ""}`}
      >
        {children || <span className="italic text-zinc-500">Empty message</span>}
      </div>
    </div>
  );
}

/** Button template: message text with a tappable button underneath (Instagram web + mobile). */
function ButtonCard({ text, label }: { text: string; label: string }) {
  const shown = [...label];
  return (
    <div className="flex justify-start">
      <div className="w-[80%] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800">
        <p className="whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-snug text-zinc-100">
          {text || <span className="italic text-zinc-500">Empty message</span>}
        </p>
        <div className="border-t border-zinc-700 py-2 text-center text-[12.5px] font-medium text-sky-400">
          {shown.length > 20 ? `${shown.slice(0, 19).join("")}…` : label || "Button"}
        </div>
      </div>
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[10px] uppercase tracking-wide text-zinc-600">
      <span className="h-px flex-1 bg-zinc-800" />
      {children}
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "your-link.com";
  }
}

export function PhonePreview({ a, ownUsername }: { a: AutomationInput; ownUsername: string }) {
  const [variation, setVariation] = useState(0);
  const replies = a.publicReplies.filter((r) => r.trim());
  const reply = replies.length ? replies[variation % replies.length] : "";
  const sampleComment =
    a.keywordMode === "KEYWORDS" && a.keywords.length ? `${a.keywords[0]} please! 🙏` : "This is amazing 😍";

  return (
    <div className="mx-auto w-[330px] rounded-[2.2rem] border border-zinc-700 bg-black p-2.5 shadow-2xl shadow-black/50">
      <div className="overflow-hidden rounded-[1.7rem] bg-zinc-950">
        {/* Comment section */}
        <div className="border-b border-zinc-800/80 px-3.5 pb-3 pt-4">
          <div className="mb-3 flex items-center gap-2.5">
            <MediaThumb media={a.mediaScope === "SPECIFIC" ? a.media : null} className="size-10 shrink-0 rounded-md" />
            <div className="min-w-0 text-[12px]">
              <p className="font-semibold text-zinc-200">@{ownUsername}</p>
              <p className="truncate text-zinc-500">
                {a.mediaScope === "SPECIFIC" ? (a.media?.caption ?? "Selected post") : "Any of your posts"}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Avatar label={SAMPLE.username} />
            <div className="min-w-0 flex-1 text-[12.5px]">
              <p className="text-zinc-200">
                <span className="mr-1.5 font-semibold">{SAMPLE.username}</span>
                {sampleComment}
              </p>
              <p className="mt-0.5 flex items-center gap-3 text-[10.5px] text-zinc-500">
                1m <span>Reply</span>
                <Heart className="ml-auto size-3" />
              </p>
            </div>
          </div>

          {a.publicReplyEnabled && (
            <div className="ml-8 mt-2.5 flex gap-2">
              <Avatar label={ownUsername} me />
              <div className="min-w-0 flex-1 text-[12.5px]">
                <p className="whitespace-pre-wrap break-words text-zinc-200">
                  <span className="mr-1.5 font-semibold">{ownUsername}</span>
                  {fill(reply) || <span className="italic text-zinc-500">Empty reply</span>}
                </p>
                {replies.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setVariation((v) => v + 1)}
                    className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300"
                  >
                    <RefreshCw className="size-3" /> Variation {(variation % replies.length) + 1} of {replies.length}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* DM thread */}
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2.5">
          <ChevronLeft className="size-4 text-zinc-400" />
          <Avatar label={ownUsername} me />
          <span className="text-[12.5px] font-semibold text-zinc-200">{ownUsername}</span>
          <MessageCircle className="ml-auto size-4 text-zinc-500" />
        </div>

        <div className="max-h-[max(360px,calc(100vh-24rem))] space-y-2 overflow-y-auto px-3 py-3">
          <Divider>Private reply to comment</Divider>
          <ButtonCard text={fill(a.openingMessage)} label={fill(a.openingButton)} />
          <Bubble from="user">{fill(a.openingButton)}</Bubble>

          {a.followGateEnabled && (
            <>
              <Divider>If not following · up to {a.maxFollowChecks}×</Divider>
              <ButtonCard text={fill(a.notFollowingMessage)} label={fill(a.notFollowingButton)} />
              <Bubble from="user">{fill(a.notFollowingButton)}</Bubble>
            </>
          )}

          <Divider>Delivery</Divider>
          <Bubble from="business">{fill(a.deliveryMessage)}</Bubble>
          <div className="flex justify-start">
            <div className="w-[80%] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
              <div className="px-3 py-2.5">
                <p className="break-words text-[13px] font-semibold text-zinc-100">
                  {fill(a.deliveryCardTitle) || <span className="italic text-zinc-500">Card title</span>}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{hostOf(a.deliveryUrl)}</p>
              </div>
              <div className="flex items-center justify-center gap-1.5 border-t border-zinc-800 py-2 text-[12.5px] font-medium text-sky-400">
                {fill(a.deliveryButton) || "Open link"} <ExternalLink className="size-3" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2.5 flex items-center justify-center gap-1 px-2 text-center text-[10.5px] text-zinc-500">
        <Info className="size-3" /> Preview as @{SAMPLE.username} (first name “{SAMPLE.first_name}”)
      </p>
    </div>
  );
}
