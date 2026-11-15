"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clapperboard, Image as ImageIcon, Layers, Loader2, X } from "lucide-react";
import { mediaKindLabel, type MediaRef } from "@/lib/automations/schema";
import { withBasePath } from "@/lib/base-path";

type Media = {
  id: string;
  caption?: string;
  mediaType?: string;
  productType?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp?: string;
};

function KindIcon({ m }: { m: { mediaType?: string | null; productType?: string | null } }) {
  const kind = mediaKindLabel(m);
  const Icon = kind === "Reel" || kind === "Video" ? Clapperboard : kind === "Carousel" ? Layers : ImageIcon;
  return <Icon className="size-3.5" />;
}

/** Thumbnail with a graceful fallback (Instagram CDN URLs expire). */
export function MediaThumb({ media, className = "" }: { media: MediaRef | Media | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = media?.thumbnailUrl;
  return (
    <div className={`relative overflow-hidden bg-zinc-900 ${className}`}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- external, expiring CDN URL
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid size-full place-items-center text-zinc-600">
          <ImageIcon className="size-5" />
        </div>
      )}
      {media && (
        <span className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white">
          <KindIcon m={media} />
        </span>
      )}
    </div>
  );
}

export function MediaPicker({
  open,
  selectedId,
  onClose,
  onSelect,
}: {
  open: boolean;
  selectedId?: string;
  onClose: () => void;
  onSelect: (m: MediaRef) => void;
}) {
  const [items, setItems] = useState<Media[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withBasePath(`/api/instagram/media${after ? `?after=${encodeURIComponent(after)}` : ""}`), {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((prev) => (after ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your posts.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load once when opened. After an error, wait for the Retry button (no retry loop).
  useEffect(() => {
    if (open && !loaded && !loading && !error) load();
  }, [open, loaded, loading, error, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a post or reel"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-100">Choose a post or reel</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}{" "}
              <button type="button" onClick={() => load()} className="underline underline-offset-2">
                Retry
              </button>
            </div>
          )}
          {!loaded && loading && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-lg bg-zinc-900" />
              ))}
            </div>
          )}
          {loaded && !items.length && !error && <p className="py-10 text-center text-sm text-zinc-500">No posts found on this account.</p>}

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((m) => {
              const selected = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    onSelect({
                      id: m.id,
                      permalink: m.permalink ?? null,
                      thumbnailUrl: m.thumbnailUrl ?? null,
                      caption: m.caption ?? null,
                      mediaType: m.mediaType ?? null,
                      productType: m.productType ?? null,
                    })
                  }
                  className={`group relative overflow-hidden rounded-lg text-left ring-2 transition ${
                    selected ? "ring-rose-500" : "ring-transparent hover:ring-zinc-600"
                  }`}
                  title={m.caption ?? undefined}
                >
                  <MediaThumb media={m} className="aspect-square" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
                    <p className="line-clamp-2 text-[11px] leading-tight text-zinc-200">{m.caption || <span className="text-zinc-400">No caption</span>}</p>
                    {m.timestamp && <p className="mt-0.5 text-[10px] text-zinc-400">{new Date(m.timestamp).toLocaleDateString()}</p>}
                  </div>
                  {selected && (
                    <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-rose-500 text-white">
                      <Check className="size-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {cursor && (
            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => load(cursor)}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-60"
              >
                {loading && <Loader2 className="size-4 animate-spin" />} Load more
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
