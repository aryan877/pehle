import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Flower2,
  Footprints,
  Gem,
  Heart,
  Home,
  LayoutGrid,
  MessageCircle,
  Mic2,
  Package,
  Radio,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  User,
} from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { useSession } from "~/lib/session";
import { useChannelList, useChatConnection } from "~/lib/useChat";
import { mediaUrl } from "~/lib/format";

import { useSignIn } from "./sign-in";
import { Avatar, cx } from "./ui";

/** Shop categories, in the order buyers see them. Values match the API. */
export const CATEGORIES: { value: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "sarees", label: "Sarees", icon: Sparkles },
  { value: "ethnic", label: "Ethnic wear", icon: Shirt },
  { value: "thrift", label: "Thrift", icon: Tag },
  { value: "jewellery", label: "Jewellery", icon: Gem },
  { value: "sneakers", label: "Sneakers", icon: Footprints },
  { value: "plants", label: "Plants", icon: Flower2 },
  { value: "beauty", label: "Beauty", icon: Heart },
  { value: "home", label: "Home", icon: Home },
  { value: "merch", label: "Merch", icon: Package },
  { value: "creator", label: "Creator drops", icon: Mic2 },
];

export function categoryLabel(value: string | null | undefined) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}

/** The Pehle wordmark: "pehle" with the claim dot. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display text-[22px] font-extrabold tracking-tight text-fg", className)}>
      <img src="/favicon.svg" alt="" className="size-8 rounded-[9px]" />
      pehle
    </span>
  );
}

/**
 * Marketplace-style page frame: a 56px top bar, an optional 360px left sidebar on wide screens,
 * and bottom tabs on phones. Pages pass their own sidebar (buyer browse or seller studio).
 */
export function AppShell({ sidebar, children, bare }: { sidebar?: ReactNode; children: ReactNode; bare?: boolean }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar />
      <div className="flex pt-14">
        {sidebar ? (
          <aside className="scrollbar-thin fixed bottom-0 left-0 top-14 hidden w-[360px] overflow-y-auto border-r border-line bg-surface px-2 pb-6 pt-3 xl:block">
            {sidebar}
          </aside>
        ) : null}
        <main className={cx("min-w-0 flex-1 pb-24 xl:pb-10", sidebar && "xl:pl-[380px]", !bare && "px-3 pt-3 sm:px-5 sm:pt-5")}>{children}</main>
      </div>
      <MobileTabs />
    </div>
  );
}

function TopBar() {
  const session = useSession();
  // One chat connection per tab, on every page: rooms, the inbox and the home feed share it.
  useChatConnection(Boolean(session.data?.chatLive));
  const signedIn = session.data?.me.kind === "buyer" || session.data?.me.kind === "staff";
  const unread = useChannelList(signedIn && Boolean(session.data?.chatLive)).totalUnread;
  const signIn = useSignIn();
  const me = session.data?.me;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/", label: "Browse", icon: Home, active: path === "/" },
    { to: "/live", label: "Live now", icon: Radio, active: path.startsWith("/live") || path.startsWith("/l/") },
    { to: "/inbox", label: "Inbox", icon: MessageCircle, active: path.startsWith("/inbox") },
    { to: "/me", label: "Buying", icon: ShoppingBag, active: path.startsWith("/me") || path.startsWith("/o/") },
  ] as const;
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      <Link to="/" className="flex shrink-0 items-center" aria-label="Pehle home">
        <Wordmark />
      </Link>
      <form
        className="ml-2 hidden min-w-0 max-w-[280px] flex-1 md:block"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/", search: query.trim() ? { q: query.trim() } : {} });
        }}
      >
        <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3 text-fg-2">
          <Search className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Pehle"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
            aria-label="Search drops, items and shops"
          />
        </label>
      </form>
      <nav className="mx-auto hidden h-full items-stretch md:flex" aria-label="Main">
        {tabs.map(({ to, label, icon: Icon, active }) => (
          <Link
            key={to}
            to={to}
            className={cx(
              "relative flex w-[92px] items-center justify-center lg:w-[112px]",
              active ? "text-accent" : "text-fg-2 hover:bg-white/5",
            )}
            aria-label={label}
            title={label}
          >
            <Icon className="size-6" />
            {to === "/inbox" && unread > 0 ? (
              <span className="absolute left-1/2 top-2 ml-1.5 min-w-5 rounded-full bg-live px-1.5 text-center text-[12px] font-bold leading-5 text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
            {active ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-t bg-accent" /> : null}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <Link
          to="/studio"
          className="hidden h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[14px] font-semibold text-fg hover:bg-white/15 sm:inline-flex"
        >
          <Store className="size-4" /> {me?.kind === "staff" ? "Studio" : "Sell"}
        </Link>
        {me?.kind === "buyer" ? (
          <Link to="/me" aria-label="Your account">
            <Avatar name={me.buyer.displayName} src={me.buyer.avatarUrl} size={36} />
          </Link>
        ) : me?.kind === "staff" ? (
          <Link to="/studio" aria-label="Your studio">
            <Avatar name={me.staff.displayName} src={me.staff.avatarUrl} size={36} />
          </Link>
        ) : (
          <button
            onClick={() => signIn()}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[14px] font-semibold text-white hover:bg-accent-hover"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}

function MobileTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/", label: "Browse", icon: Home, active: path === "/" },
    { to: "/live", label: "Live", icon: Radio, active: path.startsWith("/live") },
    { to: "/inbox", label: "Inbox", icon: MessageCircle, active: path.startsWith("/inbox") },
    { to: "/me", label: "You", icon: User, active: path.startsWith("/me") },
  ] as const;
  if (path.startsWith("/l/") || path.startsWith("/studio")) return null;
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95 pt-1.5 backdrop-blur md:hidden"
      aria-label="Main"
    >
      {tabs.map(({ to, label, icon: Icon, active }) => (
        <Link key={to} to={to} className={cx("flex flex-col items-center gap-0.5 py-1 text-[11px] font-semibold", active ? "text-accent" : "text-fg-2")}>
          <Icon className="size-6" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** A sidebar row: round icon, label, optional trailing content. Marketplace's 52px rows. */
export function SideRow({
  to,
  search,
  icon: Icon,
  label,
  active,
  trailing,
}: {
  to: string;
  search?: Record<string, string>;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      className={cx("flex h-[52px] items-center gap-3 rounded-lg px-2 text-[15px] font-medium", active ? "bg-white/10" : "hover:bg-white/5")}
    >
      <span className={cx("flex size-9 items-center justify-center rounded-full", active ? "bg-accent text-white" : "bg-surface-3 text-fg")}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

/** The buyer's browse sidebar: search, places, the sell button and categories. */
export function BrowseSidebar({ category }: { category?: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-1">
      <h1 className="px-2 pb-2 font-display text-[24px] font-bold">Browse</h1>
      <form
        className="px-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/", search: query.trim() ? { q: query.trim() } : {} });
        }}
      >
        <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3 text-fg-2">
          <Search className="size-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search drops and shops"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
          />
        </label>
      </form>
      <SideRow to="/" icon={LayoutGrid} label="Browse all" active={path === "/" && !category} />
      <SideRow to="/live" icon={Radio} label="Live now" active={path.startsWith("/live")} />
      <SideRow to="/inbox" icon={MessageCircle} label="Inbox" active={path.startsWith("/inbox")} />
      <SideRow to="/me" icon={ShoppingBag} label="Buying" active={path.startsWith("/me")} />
      <div className="px-2 py-2">
        <Link
          to="/sell"
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent-soft text-[15px] font-semibold text-accent hover:bg-accent/25"
        >
          <Store className="size-4" /> Sell on Pehle
        </Link>
      </div>
      <div className="mx-2 border-t border-line" />
      <p className="px-2 pb-1 pt-3 text-[17px] font-semibold">Categories</p>
      {CATEGORIES.map((c) => (
        <SideRow key={c.value} to="/" search={{ category: c.value }} icon={c.icon} label={c.label} active={category === c.value} />
      ))}
    </div>
  );
}

/** Square photo tile with the hairline border Marketplace uses. */
export function PhotoTile({ path, alt, className, children }: { path?: string | null; alt: string; className?: string; children?: ReactNode }) {
  const src = mediaUrl(path);
  return (
    <div className={cx("tile aspect-square", className)}>
      {src ? <img src={src} alt={alt} loading="lazy" className="size-full object-cover" /> : <div className="size-full bg-surface-3" />}
      {children}
    </div>
  );
}
