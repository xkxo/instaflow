"use client";

import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Plus, X, XCircle } from "lucide-react";
import { LIMITS, measure, VARIABLES, type VariableName } from "@/lib/automations/schema";

// ── Layout ──────────────────────────────────────────────────────────────────

export function Section({
  step,
  title,
  description,
  aside,
  children,
}: {
  step?: number;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {step !== undefined && (
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300">
              {step}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-400">
        {children}
      </label>
      {hint}
    </div>
  );
}

export function Issue({ error, warning }: { error?: string; warning?: string }) {
  if (!error && !warning) return null;
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${error ? "text-red-400" : "text-amber-300"}`}>
      {error ? <XCircle className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
      {error ?? warning}
    </p>
  );
}

const inputCls = (bad?: boolean) =>
  `w-full rounded-lg border bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:ring-2 ${
    bad ? "border-red-800 focus:ring-red-900/40" : "border-zinc-800 focus:border-zinc-600 focus:ring-zinc-700/40"
  }`;

// ── Length counter ──────────────────────────────────────────────────────────

export type LimitKind = "dm" | "quickReply" | "button" | "cardTitle" | "comment";

function limitFor(kind: LimitKind) {
  switch (kind) {
    case "dm":
      return { limit: LIMITS.dmBytes, unit: "bytes" as const };
    case "quickReply":
      return { limit: LIMITS.quickReplyChars, unit: "chars" as const };
    case "button":
      return { limit: LIMITS.buttonTitleChars, unit: "chars" as const };
    case "cardTitle":
      return { limit: LIMITS.cardTitleChars, unit: "chars" as const };
    case "comment":
      return { limit: LIMITS.commentChars, unit: "chars" as const };
  }
}

export function Counter({ text, kind }: { text: string; kind: LimitKind }) {
  const { limit, unit } = limitFor(kind);
  const m = measure(text);
  const now = unit === "bytes" ? m.bytes : m.chars;
  const worst = unit === "bytes" ? m.maxBytes : m.maxChars;
  const color = now > limit ? "text-red-400" : worst > limit || now > limit * 0.9 ? "text-amber-300" : "text-zinc-500";
  return (
    <span
      className={`font-mono text-[11px] tabular-nums ${color}`}
      title={unit === "bytes" ? "Instagram limits DMs to 1000 bytes of UTF-8 (emoji count as 4)." : undefined}
    >
      {now}/{limit}
      {unit === "bytes" ? " bytes" : ""}
      {m.hasVariables && worst !== now ? ` · ≤${worst}` : ""}
    </span>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Text input or textarea with {variable} insert buttons and a limit counter. */
export function TemplateField({
  id,
  label,
  value,
  onChange,
  kind,
  multiline,
  placeholder,
  error,
  warning,
  variables = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind: LimitKind;
  multiline?: boolean;
  placeholder?: string;
  error?: string;
  warning?: string;
  variables?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const insert = (name: VariableName) => {
    const el = ref.current;
    const token = VARIABLES[name].label;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const common = {
    id,
    ref,
    value,
    placeholder,
    "aria-invalid": !!error,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    className: inputCls(!!error),
  };

  return (
    <div>
      <Label htmlFor={id} hint={<Counter text={value} kind={kind} />}>
        {label}
      </Label>
      {multiline ? <textarea rows={3} {...common} className={`${common.className} resize-y`} /> : <input type="text" {...common} />}
      {variables && (
        <div className="mt-1.5 flex gap-1.5">
          {(Object.keys(VARIABLES) as VariableName[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => insert(n)}
              className="rounded-md border border-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-300"
            >
              + {VARIABLES[n].label}
            </button>
          ))}
        </div>
      )}
      <Issue error={error} warning={warning} />
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  warning,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  warning?: string;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls(!!error)}
      />
      <Issue error={error} warning={warning} />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        checked ? "bg-gradient-to-r from-fuchsia-600 to-rose-500" : "bg-zinc-700"
      }`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            value === o.value ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chip input: Enter or comma adds; Backspace on empty removes the last; paste splits on commas/newlines. */
export function KeywordInput({
  value,
  onChange,
  error,
  warning,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  error?: string;
  warning?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(/[,\n]/)) {
      const k = part.trim();
      if (k && !next.some((x) => x.toLowerCase() === k.toLowerCase())) next.push(k);
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div>
      <div
        className={`flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-zinc-950/60 px-2 py-1.5 ${
          error ? "border-red-800" : "border-zinc-800 focus-within:border-zinc-600"
        }`}
      >
        {value.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-md bg-zinc-800 py-0.5 pl-2 pr-1 text-sm text-zinc-200">
            {k}
            <button
              type="button"
              aria-label={`Remove ${k}`}
              onClick={() => onChange(value.filter((x) => x !== k))}
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          aria-label="Add keyword"
          placeholder={value.length ? "Add another…" : "e.g. link, guide, price"}
          onChange={(e) => (/[,\n]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </div>
      <Issue error={error} warning={warning} />
    </div>
  );
}

/** Editable list of reply variations. */
export function VariationsField({
  values,
  onChange,
  errors,
  warnings,
  listError,
  listWarning,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  errors: Record<string, string>;
  warnings: Record<string, string>;
  listError?: string;
  listWarning?: string;
}) {
  return (
    <div className="space-y-3">
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <TemplateField
              id={`publicReplies-${i}`}
              label={`Variation ${i + 1}`}
              value={v}
              kind="comment"
              onChange={(nv) => onChange(values.map((x, j) => (j === i ? nv : x)))}
              error={errors[`publicReplies.${i}`]}
              warning={warnings[`publicReplies.${i}`]}
            />
          </div>
          <button
            type="button"
            aria-label={`Remove variation ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="mt-6 rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      {values.length < LIMITS.maxPublicReplies && (
        <button
          type="button"
          onClick={() => onChange([...values, ""])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
        >
          <Plus className="size-4" /> Add variation
        </button>
      )}
      <Issue error={listError} warning={listWarning} />
    </div>
  );
}
