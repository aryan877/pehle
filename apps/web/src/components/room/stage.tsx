import { ChevronLeft, ChevronRight, ExternalLink, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cx } from "~/components/ui";
import { mediaUrl, streamHost, youtubeEmbed } from "~/lib/format";

import type { RoomItem, RoomModel } from "./model";

function streamCopy(url: string | null) {
  const host = streamHost(url);
  if (host === "instagram") return "Watching on Instagram? Keep Pehle open beside it to claim.";
  if (host === "facebook") return "Watching on Facebook? Keep Pehle open beside it to claim.";
  if (url) return "Watch the live in its app, and claim here.";
  return null;
}

/**
 * Photos of one item. `viewer` is Marketplace's item viewer (blurred backdrop, arrows and a
 * thumbnail strip); `fill` covers its parent for the phone's full-bleed room, swiped sideways.
 */
export function Gallery({ photos, alt, variant, className }: { photos: string[]; alt: string; variant: "viewer" | "fill"; className?: string }) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const key = photos.join("|");
  useEffect(() => setIndex(0), [key]);
  const safe = Math.min(index, Math.max(photos.length - 1, 0));
  const current = mediaUrl(photos[safe]);

  if (variant === "fill") {
    return (
      <div className={cx("relative size-full", className)}>
        <div
          ref={strip}
          className="no-scrollbar flex size-full snap-x snap-mandatory overflow-x-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
          }}
          aria-label={`${alt}, ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        >
          {photos.map((p, i) => (
            <img
              key={p}
              src={mediaUrl(p) ?? undefined}
              alt={i === 0 ? alt : ""}
              className="size-full shrink-0 snap-center object-cover"
              draggable={false}
              loading={i === 0 ? "eager" : "lazy"}
            />
          ))}
        </div>
        {photos.length > 1 ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-[calc(max(env(safe-area-inset-top),0.75rem)+3.25rem)] flex justify-center gap-1"
            aria-hidden
          >
            {photos.map((p, i) => (
              <span key={p} className={cx("h-1 rounded-full transition-all", i === safe ? "w-5 bg-white" : "w-1.5 bg-white/45")} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const go = (to: number) => setIndex((to + photos.length) % photos.length);
  return (
    <div className={cx("relative overflow-hidden bg-black", className)}>
      {current ? <img src={current} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-2xl" aria-hidden /> : null}
      <div className="relative flex h-full items-center justify-center">
        {current ? <img src={current} alt={alt} className="max-h-full max-w-full object-contain" /> : null}
        {photos.length > 1 ? (
          <>
            <button
              onClick={() => go(safe - 1)}
              className="absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3/90 text-fg shadow-lift hover:bg-surface-3"
              aria-label="Previous photo"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              onClick={() => go(safe + 1)}
              className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3/90 text-fg shadow-lift hover:bg-surface-3"
              aria-label="Next photo"
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {photos.map((p, i) => (
                <button
                  key={p}
                  onClick={() => setIndex(i)}
                  className={cx(
                    "size-12 overflow-hidden rounded-md ring-2 transition",
                    i === safe ? "ring-white" : "opacity-60 ring-transparent hover:opacity-100",
                  )}
                  aria-label={`Photo ${i + 1}`}
                  aria-current={i === safe}
                >
                  <img src={mediaUrl(p) ?? undefined} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The desktop stage: the YouTube live itself, or the pinned item's photos with a link to the stream. */
export function DesktopStage({ model }: { model: RoomModel }) {
  const url = model.snapshot.streamUrl ?? model.data.live.streamUrl ?? null;
  const embed = youtubeEmbed(url);
  const item = model.pinned;
  if (embed) {
    return (
      <div className="bg-black">
        <iframe
          src={embed}
          title={model.data.live.title}
          className="mx-auto aspect-video max-h-[62vh] w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const copy = streamCopy(url);
  return (
    <div className="relative">
      {item && item.photos.length ? (
        <Gallery photos={item.photos} alt={item.title} variant="viewer" className="h-[52vh] min-h-80" />
      ) : (
        <Waiting model={model} className="h-[40vh] min-h-72" />
      )}
      {copy && url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/60 py-1.5 pl-3 pr-3.5 text-[13px] font-semibold text-white backdrop-blur hover:bg-black/75"
        >
          <Radio className="size-4 text-live" aria-hidden /> {copy} <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/** Phones: the stage fills the screen behind the chat and the claim bar. */
export function PhoneStage({ model }: { model: RoomModel }) {
  const url = model.snapshot.streamUrl ?? model.data.live.streamUrl ?? null;
  const embed = youtubeEmbed(url);
  const item = model.pinned;
  const backdrop = mediaUrl(item?.photos[0] ?? model.data.shop.avatarPath);
  if (embed) {
    return (
      <div className="absolute inset-0 bg-black">
        {backdrop ? (
          <img src={backdrop} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-35 blur-2xl" aria-hidden />
        ) : null}
        <iframe
          src={embed}
          title={model.data.live.title}
          className="relative mt-[calc(max(env(safe-area-inset-top),0.75rem)+3rem)] aspect-video w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-0 bg-black">
      {item && item.photos.length ? (
        <Gallery photos={item.photos} alt={item.title} variant="fill" />
      ) : (
        <Waiting model={model} className="size-full" />
      )}
      <StreamChip url={url} />
    </div>
  );
}

function StreamChip({ url }: { url: string | null }) {
  const copy = streamCopy(url);
  if (!copy || !url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="absolute left-3 top-[calc(max(env(safe-area-inset-top),0.75rem)+3.25rem)] z-10 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur"
    >
      <Radio className="size-3.5 shrink-0 text-live" aria-hidden /> <span className="truncate">Open the live stream</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/** Between items: the shop's face and a calm "next item coming up". */
function Waiting({ model, className }: { model: RoomModel; className?: string }) {
  const avatar = mediaUrl(model.data.shop.avatarPath);
  return (
    <div className={cx("relative flex items-center justify-center overflow-hidden bg-black", className)}>
      {avatar ? <img src={avatar} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-3xl" aria-hidden /> : null}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(255_45_120/0.18),transparent_65%)]" aria-hidden />
      <div className="relative px-6 text-center">
        <p className="text-[13px] font-semibold text-white/70">{model.data.shop.displayName}</p>
        <p className="mt-1 text-balance font-display text-2xl font-bold text-white">Next item coming up</p>
        <p className="mt-1 text-[14px] text-white/70">Stay here. The claim button lights up the moment it drops.</p>
      </div>
    </div>
  );
}

export type { RoomItem };
