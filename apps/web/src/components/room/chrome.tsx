import { Link } from "@tanstack/react-router";
import { ChevronLeft, Eye, MessageCircle, ShoppingBag } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Wordmark } from "~/components/shell";
import { Avatar, cx } from "~/components/ui";
import { mediaUrl } from "~/lib/format";

import type { RoomModel } from "./model";
import { ClubAction, MessageShopButton, ShopLink } from "./shop";

export function LivePill({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded bg-live px-1.5 text-[12px] font-bold leading-[20px] tracking-wide text-white", className)}
    >
      <span className="relative inline-flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
        <span className="relative inline-flex size-1.5 rounded-full bg-white" />
      </span>
      LIVE
    </span>
  );
}

export function Viewers({ count, glass }: { count: number; glass?: boolean }) {
  return (
    <span
      className={cx(
        "tabular inline-flex items-center gap-1 text-[13px] font-semibold",
        glass ? "rounded bg-black/55 px-1.5 leading-[20px] text-white backdrop-blur" : "text-[#ff8280]",
      )}
      title="Watching in Pehle right now"
    >
      <Eye className="size-3.5" aria-hidden />
      <span className="sr-only">Watching: </span>
      {count.toLocaleString("en-IN")}
    </span>
  );
}

function useUptime(startedAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Desktop: a slim bar with the wordmark, where you are, and your inbox and orders. */
export function DesktopTopBar({ model }: { model: RoomModel }) {
  const { data } = model;
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <Link to="/" aria-label="Pehle home" className="shrink-0">
        <Wordmark />
      </Link>
      <span className="h-6 w-px bg-line-strong" aria-hidden />
      <p className="min-w-0 truncate text-[14px] text-fg-2">
        <b className="text-fg">{data.shop.displayName}</b>
        <span className="mx-2.5 inline-block h-3.5 w-px translate-y-0.5 bg-line-strong" aria-hidden />
        {data.live.title}
      </p>
      <nav className="ml-auto flex items-center gap-1" aria-label="Your stuff">
        <TopLink to="/inbox" icon={<MessageCircle className="size-[18px]" />} label="Inbox" />
        <TopLink to="/me" icon={<ShoppingBag className="size-[18px]" />} label="Buying" />
      </nav>
    </header>
  );
}

function TopLink({ to, icon, label }: { to: "/inbox" | "/me"; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold text-fg-2 hover:bg-white/10 hover:text-fg">
      {icon}
      {label}
    </Link>
  );
}

/** Under the player: who is selling, what this drop is, and the club and message actions. */
export function InfoBar({ model }: { model: RoomModel }) {
  const { data } = model;
  const live = model.status === "live";
  const uptime = useUptime(live ? data.live.startedAt : null);
  return (
    <div className="flex flex-wrap items-start gap-4 px-6 py-4">
      <ShopLink handle={data.shop.handle} className="relative shrink-0" aria-label={`${data.shop.displayName} shop page`}>
        <span className={cx("block rounded-full p-[3px]", live ? "bg-live" : "bg-line-strong")}>
          <Avatar name={data.shop.displayName} src={mediaUrl(data.shop.avatarPath)} size={60} className="ring-[3px] ring-canvas" />
        </span>
        {live ? <LivePill className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 ring-2 ring-canvas" /> : null}
      </ShopLink>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-[22px] font-bold leading-tight">{data.live.title}</h1>
        <p className="mt-0.5 truncate text-[15px] font-semibold text-fg-2">
          <ShopLink handle={data.shop.handle} className="hover:underline">
            {data.shop.displayName}
          </ShopLink>
          {data.shop.city ? <span className="font-normal text-muted">, {data.shop.city}</span> : null}
        </p>
        {data.live.description ? <p className="mt-1 line-clamp-2 text-[14px] text-muted">{data.live.description}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="flex max-w-[400px] flex-wrap items-center justify-end gap-2">
          <ClubAction room={data} signedIn={Boolean(model.buyer)} withAlerts />
          <MessageShopButton handle={data.shop.handle} compact />
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          {model.chat.participants !== null ? <Viewers count={model.chat.participants} /> : null}
          {uptime ? (
            <span className="tabular text-fg-2" title="Live for">
              {uptime}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Phones: the shop, live badge and head count floating over the stream. */
export function PhoneHeader({ model }: { model: RoomModel }) {
  const { data } = model;
  return (
    <div className="scrim-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-2 px-3 pb-8 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <Link
        to="/live"
        className="pointer-events-auto -ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-white"
        aria-label="Back to live drops"
      >
        <ChevronLeft className="size-6 drop-shadow" />
      </Link>
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <ShopLink handle={data.shop.handle} className="shrink-0" aria-label={`${data.shop.displayName} shop page`}>
          <Avatar name={data.shop.displayName} src={mediaUrl(data.shop.avatarPath)} size={36} className="ring-2 ring-white/25" />
        </ShopLink>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold leading-tight text-white drop-shadow">{data.shop.displayName}</p>
          <p className="truncate text-[12px] leading-tight text-white/75 drop-shadow">{data.live.title}</p>
        </div>
      </div>
      <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1.5">
        {model.status === "live" ? <LivePill /> : null}
        {model.chat.participants !== null ? <Viewers count={model.chat.participants} glass /> : null}
      </div>
    </div>
  );
}
