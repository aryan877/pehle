import { Bell, CalendarClock, Gift, ImageIcon, Lock, Radio } from "lucide-react";
import type { ReactNode } from "react";

import { categoryLabel } from "~/components/shell";
import { Avatar, Badge, CodeChip, cx } from "~/components/ui";

import { priceLabel } from "./bits";

function Photo({ src, alt, className, children }: { src?: string | null; alt: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cx("tile", className)}>
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center bg-surface-3 text-muted">
          <ImageIcon className="size-8" aria-hidden />
        </div>
      )}
      {children}
    </div>
  );
}

/** The Marketplace browse tile: square photo, price first, then title and place. */
export function BrowseTilePreview({ src, code, title, pricePaise, meta }: { src?: string | null; code: string; title: string; pricePaise: number | null; meta: string }) {
  return (
    <div className="w-full max-w-[266px]">
      <Photo src={src} alt={title} className="aspect-square">
        {code ? <CodeChip code={code} className="absolute left-2 top-2" /> : null}
      </Photo>
      <p className="tabular mt-1.5 text-[17px] font-bold leading-snug">{pricePaise === null ? "Price" : priceLabel(pricePaise)}</p>
      <p className="truncate text-[15px] leading-snug">{title || "Title"}</p>
      <p className="truncate text-[13px] text-fg-2">{meta}</p>
    </div>
  );
}

/** How the item looks in the room when the seller opens it for claims. */
export function RoomItemPreview({
  src,
  code,
  title,
  pricePaise,
  quantity,
}: {
  src?: string | null;
  code: string;
  title: string;
  pricePaise: number | null;
  quantity: number;
}) {
  const free = pricePaise === 0;
  return (
    <div className="overflow-hidden rounded-2xl bg-canvas ring-1 ring-line">
      <div className="flex gap-3 p-3 sm:gap-4 sm:p-4">
        <Photo src={src} alt="" className="size-[88px] shrink-0 rounded-xl sm:size-28">
          {code ? <CodeChip code={code} className="absolute left-1.5 top-1.5" /> : null}
        </Photo>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-accent">Up for claims</p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-bold leading-snug">{title || "Your item title"}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular font-display text-2xl font-extrabold text-gold">{pricePaise === null ? "₹0" : priceLabel(pricePaise)}</span>
            <span className="text-[12px] font-semibold text-fg-2">
              {quantity} of {quantity} left
            </span>
          </div>
          <div className="mt-2 flex h-1.5 max-w-[200px] gap-1" aria-hidden>
            {Array.from({ length: Math.min(Math.max(quantity, 1), 12) }).map((_, i) => (
              <span key={i} className="flex-1 rounded-full bg-surface-3" />
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-line px-3 py-2.5 sm:px-4">
        <div className="rounded-xl bg-accent py-3 text-center text-[16px] font-extrabold text-white">Mine! Claim {code || "it"}</div>
        <p className="mt-1.5 text-center text-[12px] text-muted">{free ? "Free. First to claim wins it." : "First to claim gets a few minutes to pay."}</p>
      </div>
    </div>
  );
}

/** What the winner sees once the item is theirs. */
export function WinnerNotePreview({ note, code }: { note: string; code: string }) {
  return (
    <div className="rounded-2xl bg-good-soft p-4 ring-1 ring-good/25">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-good">
        <Gift className="size-4" /> {code || "It"} is yours
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] text-fg">{note}</p>
      <p className="mt-2 flex items-center gap-1 text-[12px] text-muted">
        <Lock className="size-3" /> Only the winner sees this
      </p>
    </div>
  );
}

/** The drop card as buyers see it on the home page and the shop page. */
export function DropCardPreview({
  coverSrc,
  title,
  shopName,
  avatarSrc,
  city,
  when,
  itemCount,
  live,
}: {
  coverSrc?: string | null;
  title: string;
  shopName: string;
  avatarSrc?: string | null;
  city?: string | null;
  when: string | null;
  itemCount: number;
  live?: boolean;
}) {
  return (
    <div className="w-full max-w-[320px]">
      <Photo src={coverSrc} alt="" className="aspect-[4/3]">
        <span className="absolute left-2 top-2">
          {live ? (
            <Badge tone="live">Live</Badge>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[12px] font-semibold text-white backdrop-blur">
              <CalendarClock className="size-3.5" /> {when ?? "Time not set"}
            </span>
          )}
        </span>
      </Photo>
      <div className="mt-2 flex items-start gap-2">
        <Avatar name={shopName} src={avatarSrc} size={32} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{title || "Your drop title"}</p>
          <p className="truncate text-[13px] text-fg-2">{[shopName, city].filter(Boolean).join(", ")}</p>
          <p className="text-[13px] text-muted">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
        </div>
      </div>
      {!live ? (
        <div className="mt-2 flex h-9 items-center justify-center gap-2 rounded-lg bg-white/10 text-[15px] font-semibold">
          <Bell className="size-4" /> Remind me
        </div>
      ) : null}
    </div>
  );
}

/** The lineup strip in the room: what's coming, in order. */
export function LineupStripPreview({ items }: { items: { id: string; code: string; title: string; pricePaise: number; src?: string | null }[] }) {
  if (!items.length) {
    return <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-muted">Add items to the lineup to see them here.</p>;
  }
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
      {items.map((i, index) => (
        <div key={i.id} className="w-[104px] shrink-0">
          <Photo src={i.src} alt="" className="aspect-square">
            <CodeChip code={i.code} className="absolute left-1.5 top-1.5" />
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1 text-[11px] font-bold text-white">{index + 1}</span>
          </Photo>
          <p className="tabular mt-1 text-[13px] font-bold">{priceLabel(i.pricePaise)}</p>
          <p className="truncate text-[12px] text-fg-2">{i.title}</p>
        </div>
      ))}
    </div>
  );
}

/** The top of the public shop page: cover, avatar, name, category and city. */
export function ShopHeaderPreview({
  name,
  handle,
  category,
  city,
  tagline,
  avatarSrc,
  coverSrc,
  onAvatar,
  onCover,
}: {
  name: string;
  handle: string;
  category: string;
  city?: string | null;
  tagline?: string | null;
  avatarSrc?: string | null;
  coverSrc?: string | null;
  onAvatar?: ReactNode;
  onCover?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-canvas ring-1 ring-line">
      <div className="relative aspect-[3/1] bg-gradient-to-br from-accent-soft via-surface-2 to-gold-soft sm:aspect-[4/1]">
        {coverSrc ? <img src={coverSrc} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        {onCover ? <div className="absolute bottom-2 right-2">{onCover}</div> : null}
      </div>
      <div className="relative px-4 pb-4">
        <div className="-mt-9 flex items-end gap-3">
          <div className="relative shrink-0 rounded-full ring-4 ring-canvas">
            <Avatar name={name || "Shop"} src={avatarSrc} size={76} className="text-xl" />
            {onAvatar ? <div className="absolute -bottom-1 -right-1">{onAvatar}</div> : null}
          </div>
        </div>
        <p className="mt-2 font-display text-[22px] font-bold leading-tight">{name || "Your shop name"}</p>
        <p className="text-[14px] text-fg-2">
          @{handle || "handle"}
          {category ? `, ${categoryLabel(category)}` : ""}
          {city ? ` in ${city}` : ""}
        </p>
        {tagline ? <p className="mt-1 text-[14px] text-fg">{tagline}</p> : null}
        <div className="mt-3 flex gap-2">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[15px] font-semibold text-white">Join club</span>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-4 text-[15px] font-semibold">
            <Radio className="size-4" /> Drops
          </span>
        </div>
      </div>
    </div>
  );
}
