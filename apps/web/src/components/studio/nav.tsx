import { Link, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown, LayoutDashboard, LogOut, MessageCircle, Package, Plus, Radio, Receipt, Settings, ShoppingBag, Store, Users } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

import { SideRow, categoryLabel } from "~/components/shell";
import { Avatar, LiveDot, cx } from "~/components/ui";
import { mediaUrl } from "~/lib/format";

import { groupLives, useLives, usePendingPayments, useStats } from "./queries";
import { useShop } from "./shop-context";

interface NavEntry {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
  badge?: number;
}

function useNav(): NavEntry[] {
  const { shop } = useShop();
  const pending = usePendingPayments(shop.id);
  return [
    { to: "/studio", label: "Dashboard", icon: LayoutDashboard, match: (p) => p === "/studio" || p === "/studio/" },
    { to: "/studio/drops", label: "Drops", icon: Radio, match: (p) => p.startsWith("/studio/drops") || p.startsWith("/studio/live") },
    { to: "/studio/catalog", label: "Catalogue", icon: Package, match: (p) => p.startsWith("/studio/catalog") },
    { to: "/studio/orders", label: "Orders", icon: Receipt, match: (p) => p.startsWith("/studio/orders"), badge: pending },
    { to: "/studio/inbox", label: "Inbox", icon: MessageCircle, match: (p) => p.startsWith("/studio/inbox") },
    { to: "/studio/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/studio/settings") },
  ];
}

function CountPill({ value }: { value: number }) {
  if (!value) return null;
  return <span className="min-w-6 rounded-full bg-accent px-1.5 text-center text-[13px] font-bold leading-6 text-white">{value}</span>;
}

/** The Selling-style sidebar: shop, Create drop, then the studio pages. Desktop only. */
export function StudioSidebar({ onSignOut }: { onSignOut: () => void }) {
  const { shop, staff } = useShop();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const nav = useNav();
  const lives = useLives(shop.id);
  const stats = useStats(shop.id);
  const running = groupLives(lives.data).live[0];
  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-1">
        <h1 className="px-2 pb-1 font-display text-[24px] font-bold">Studio</h1>
        <ShopSwitcher onSignOut={onSignOut} />
        <div className="px-2 pb-2 pt-1">
          <Link
            to="/studio/drops/new"
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[15px] font-semibold text-white transition hover:bg-accent-hover"
          >
            <Plus className="size-4" /> Create drop
          </Link>
        </div>
        {running ? (
          <Link
            to="/studio/live/$liveId"
            params={{ liveId: running.id }}
            className="mx-2 mb-1 flex items-center gap-3 rounded-lg bg-live/15 px-3 py-2.5 ring-1 ring-inset ring-live/30 hover:bg-live/20"
          >
            <span className="inline-flex h-5 items-center gap-1 rounded bg-live px-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
              <LiveDot /> Live
            </span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{running.title}</span>
            <span className="text-[13px] font-semibold text-fg-2">Console</span>
          </Link>
        ) : null}
        {nav.map((n) => (
          <SideRow key={n.to} to={n.to} icon={n.icon} label={n.label} active={n.match(path)} trailing={<CountPill value={n.badge ?? 0} />} />
        ))}
      </div>

      <div className="mx-2 my-3 border-t border-line" />
      <div className="mx-2 flex items-start gap-3 rounded-lg px-1 py-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3">
          <Users className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium">
            Club <span className="tabular text-fg-2">{stats.data ? stats.data.followers.toLocaleString("en-IN") : ""}</span>
          </p>
          <p className="text-[13px] text-muted">People following your shop hear first when you go live.</p>
        </div>
      </div>

      <div className="mt-auto space-y-1 px-2 pt-6">
        <Link to="/" className="flex h-10 items-center gap-2 rounded-lg px-2 text-[14px] font-semibold text-fg-2 hover:bg-white/5 hover:text-fg">
          <ShoppingBag className="size-4" /> Switch to buying
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] font-semibold text-fg-2 hover:bg-white/5 hover:text-fg"
        >
          <LogOut className="size-4" /> Sign out <span className="min-w-0 truncate font-normal text-muted">{staff.displayName}</span>
        </button>
      </div>
    </div>
  );
}

/** Phones and tablets: the shop row and compact tabs under the top bar. */
export function StudioTabs({ onSignOut }: { onSignOut: () => void }) {
  const { shop } = useShop();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const nav = useNav();
  const lives = useLives(shop.id);
  const running = groupLives(lives.data).live[0];
  return (
    <>
      {/* Fixed heights (56px row, 49px tabs) so full-height pages can sit exactly below: 161px from the top. */}
      <div className="-mx-3 -mt-3 flex h-14 items-center gap-2 bg-surface px-3 sm:-mx-5 sm:-mt-5 sm:px-5 xl:hidden">
        <div className="min-w-0 flex-1">
          <ShopSwitcher onSignOut={onSignOut} compact />
        </div>
        {running ? (
          <Link
            to="/studio/live/$liveId"
            params={{ liveId: running.id }}
            aria-label="Live now: open the console"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-live px-2.5 text-[13px] font-bold text-white"
          >
            <LiveDot /> <span className="max-sm:hidden">Console</span>
            <span className="sm:hidden">Live</span>
          </Link>
        ) : null}
        <Link
          to="/studio/drops/new"
          aria-label="Create drop"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[14px] font-semibold text-white hover:bg-accent-hover sm:px-3"
        >
          <Plus className="size-4" /> <span className={running ? "max-sm:hidden" : "max-[359px]:hidden"}>Create drop</span>
        </Link>
      </div>
      <nav
        className="no-scrollbar sticky top-14 z-30 -mx-3 mb-4 flex h-[49px] overflow-x-auto border-b border-line bg-surface px-1 sm:-mx-5 sm:px-3 xl:hidden"
        aria-label="Studio"
      >
        {nav.map((n) => {
          const active = n.match(path);
          return (
            <Link
              key={n.to}
              to={n.to}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex h-12 shrink-0 items-center gap-1.5 px-3 text-[14px] font-semibold",
                active ? "text-accent" : "text-fg-2 hover:text-fg",
              )}
            >
              {n.label}
              {n.badge ? <span className="min-w-5 rounded-full bg-accent px-1 text-center text-[12px] font-bold leading-5 text-white">{n.badge}</span> : null}
              {active ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-accent" /> : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** Avatar, name and a menu to switch shops or sign out. */
export function ShopSwitcher({ onSignOut, compact }: { onSignOut: () => void; compact?: boolean }) {
  const ctx = useShop();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const subtitle = [categoryLabel(ctx.shop.category), ctx.shop.city].filter(Boolean).join(", ");
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx("flex w-full min-w-0 items-center gap-3 rounded-lg text-left hover:bg-white/5", compact ? "-ml-1 px-1 py-1" : "px-2 py-2")}
      >
        <Avatar name={ctx.shop.displayName} src={mediaUrl(ctx.shop.avatarPath)} size={compact ? 32 : 40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">{ctx.shop.displayName}</span>
          <span className="block truncate text-[13px] text-muted">{compact ? `@${ctx.shop.handle}` : subtitle || `@${ctx.shop.handle}`}</span>
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-fg-2 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-1 min-w-64 animate-rise rounded-xl bg-surface-2 p-1.5 shadow-lift ring-1 ring-white/5">
          <p className="px-2.5 pb-1 pt-1.5 text-[13px] font-semibold text-fg-2">{ctx.shops.length > 1 ? "Your shops" : "Your shop"}</p>
          {ctx.shops.map((s) => (
            <button
              key={s.seller.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.seller.id === ctx.shop.id}
              onClick={() => {
                ctx.switchShop(s.seller.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
            >
              <Avatar name={s.seller.displayName} src={mediaUrl(s.seller.avatarPath)} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{s.seller.displayName}</span>
                <span className="block truncate text-[13px] text-muted">
                  @{s.seller.handle}
                  {s.role === "moderator" ? ", moderator" : ""}
                </span>
              </span>
              {s.seller.id === ctx.shop.id ? <Check className="size-4 text-accent" /> : null}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <Link
            to="/s/$handle"
            params={{ handle: ctx.shop.handle }}
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-semibold text-fg-2 hover:bg-white/5 hover:text-fg"
          >
            <Store className="size-4" /> View your shop page
          </Link>
          <Link to="/" role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[14px] font-semibold text-fg-2 hover:bg-white/5 hover:text-fg">
            <ShoppingBag className="size-4" /> Switch to buying
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-semibold text-fg-2 hover:bg-white/5 hover:text-fg"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
