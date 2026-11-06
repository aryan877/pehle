import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, BellRing, ChevronLeft, ChevronRight, Copy, Eye, Search, Sparkles, Users, Zap } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { api, keys, unwrap, type DropCard, type PickCard, type ShopItem } from "~/lib/api";
import { mediaUrl, rupees } from "~/lib/format";
import { buyerOf, useSession } from "~/lib/session";

import { CATEGORIES, PhotoTile } from "./shell";
import { useSignIn } from "./sign-in";
import { Avatar, Badge, LiveDot, cx, errorMessage, useToast } from "./ui";

// --- Data --------------------------------------------------------------------------------------

/** The home feed. `demo` adds the practice shop. */
export function useBrowse(category?: string, q?: string) {
  return useQuery({
    queryKey: keys.browse(category, q),
    queryFn: () => unwrap(api.GET("/api/v1/browse", { params: { query: { category, q } } })),
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
  });
}

/** Button looks for links, matching `Button` in ui.tsx (8px corners, 36px default height). */
export function linkButton(variant: "primary" | "secondary" | "soft" | "success" = "primary", size: "md" | "lg" | "xl" = "md", extra?: string) {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 font-semibold transition active:scale-[0.98]",
    variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
    variant === "secondary" && "bg-white/10 text-fg hover:bg-white/15",
    variant === "soft" && "bg-accent-soft text-accent hover:bg-accent/25",
    variant === "success" && "bg-good text-white hover:brightness-110",
    size === "md" && "h-9 rounded-lg px-4 text-[15px]",
    size === "lg" && "h-11 rounded-lg px-5 text-[15px]",
    size === "xl" && "h-13 rounded-xl px-6 text-base",
    extra,
  );
}

// --- Time ----------------------------------------------------------------------------------------

/** "8:00 PM", or "8 PM" with `short` when the minutes are zero. */
export function clockTime(date: Date, short = false): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "AM" : "PM";
  if (short && m === 0) return `${hour} ${suffix}`;
  return `${hour}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function dayDiff(date: Date, now = new Date()): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** "Today 8:00 PM", "Tomorrow 9:00 PM", "Sat 22 Nov, 8:00 PM". Pass `short` for "Today 8 PM". */
export function dropWhen(iso: string, short = false): string {
  const date = new Date(iso);
  const days = dayDiff(date);
  const time = clockTime(date, short);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  const day = date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
  return `${day}, ${time}`;
}

/** "Today 8 PM" -> "today 8 PM", for use mid-sentence. */
export function inline(when: string): string {
  return when.replace(/^(Today|Tomorrow|Yesterday)/, (m) => m.toLowerCase());
}

/** "in 45 min", "in 2 h 10 min", or null when more than a day away or already passed. */
export function startsIn(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0 || ms > 86_400_000) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function priceLabel(paise: number): string {
  return paise === 0 ? "Free" : rupees(paise);
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

/** "Meera Sarees, Noida" or just the name. */
export function place(name: string, city: string | null | undefined): string {
  return city ? `${name}, ${city}` : name;
}

// --- Shop avatar ---------------------------------------------------------------------------------

export function ShopAvatar({ name, path, size = 36, className }: { name: string; path?: string | null; size?: number; className?: string }) {
  const src = mediaUrl(path);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cx("shrink-0 rounded-full bg-surface-3 object-cover", className)}
      />
    );
  }
  return <Avatar name={name} size={size} className={className} />;
}

// --- Section layout ------------------------------------------------------------------------------

export function Section({
  title,
  id,
  action,
  sub,
  children,
}: {
  title: string;
  id: string;
  action?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-[20px] font-bold leading-tight text-fg">
            {title}
          </h2>
          {sub ? <p className="mt-0.5 text-[13px] text-fg-2">{sub}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SeeAll({ to, label = "See all" }: { to: "/live"; label?: string }) {
  return (
    <Link to={to} className="rounded-md px-1 text-[15px] font-semibold text-info hover:underline">
      {label}
    </Link>
  );
}

/** A horizontal row of cards with snap scrolling, and arrow buttons on wide screens when it overflows. */
export function Rail({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <div className="relative">
      <div
        ref={ref}
        role="list"
        aria-label={label}
        className="no-scrollbar -mx-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 sm:-mx-5 sm:scroll-px-5 sm:px-5"
      >
        {children}
      </div>
      {!edges.start ? <RailButton dir={-1} onClick={() => by(-1)} /> : null}
      {!edges.end ? <RailButton dir={1} onClick={() => by(1)} /> : null}
    </div>
  );
}

function RailButton({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  const Icon = dir === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === 1 ? "Scroll right" : "Scroll left"}
      className={cx(
        "absolute top-[84px] z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3 text-fg shadow-lift hover:bg-line-strong md:flex",
        dir === 1 ? "-right-2" : "-left-2",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

const railItem = "w-[78vw] max-w-[300px] shrink-0 snap-start sm:w-[300px]";

// --- Drop cards ----------------------------------------------------------------------------------

/** Live drops show the stream's thumbnail; upcoming and past drops show what is (or was) on offer. */
function dropThumb(drop: DropCard): string | null {
  const stream = drop.youtubeVideoId ? `https://i.ytimg.com/vi/${drop.youtubeVideoId}/hqdefault.jpg` : null;
  return drop.status === "live" ? (stream ?? mediaUrl(drop.coverPath)) : (mediaUrl(drop.coverPath) ?? stream);
}

function Thumb({ drop, children, dim }: { drop: DropCard; children?: ReactNode; dim?: boolean }) {
  const src = dropThumb(drop);
  return (
    <div className="tile aspect-video rounded-xl">
      {src ? (
        <img
          src={src}
          alt={`${drop.title}, from ${drop.shopName}`}
          loading="lazy"
          className={cx("size-full object-cover transition duration-300 group-hover:scale-[1.03]", dim && "opacity-70")}
        />
      ) : (
        <div className="size-full bg-[radial-gradient(circle_at_30%_20%,rgb(255_45_120/0.25),transparent_60%)]" />
      )}
      {children}
    </div>
  );
}

function DropMeta({ drop, children }: { drop: DropCard; children?: ReactNode }) {
  return (
    <div className="mt-2.5 flex gap-2.5">
      <Link to="/s/$handle" params={{ handle: drop.shopHandle }} className="shrink-0 self-start rounded-full" aria-label={`${drop.shopName} shop page`}>
        <ShopAvatar name={drop.shopName} path={drop.shopAvatarPath} size={36} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to="/l/$slug" params={{ slug: drop.slug }} className="line-clamp-2 rounded text-[15px] font-semibold leading-snug text-fg hover:underline">
          {drop.title}
        </Link>
        <Link
          to="/s/$handle"
          params={{ handle: drop.shopHandle }}
          className="mt-0.5 block truncate rounded text-[13px] text-fg-2 hover:text-fg hover:underline"
        >
          {place(drop.shopName, drop.shopCity)}
        </Link>
        {children}
      </div>
    </div>
  );
}

/** A drop that is live now: 16:9 thumbnail with the LIVE badge and who is watching. */
export function LiveCard({ drop, className, rail }: { drop: DropCard; className?: string; rail?: boolean }) {
  return (
    <article role={rail ? "listitem" : undefined} className={cx("group min-w-0", rail && railItem, className)}>
      <Link to="/l/$slug" params={{ slug: drop.slug }} className="block rounded-xl" aria-label={`Watch ${drop.title}, live now`}>
        <Thumb drop={drop}>
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <Badge tone="live" className="rounded-md px-1.5">
              <LiveDot className="size-1.5" /> Live
            </Badge>
            {drop.watching > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 text-[12px] font-semibold leading-5 text-white">
                <Eye className="size-3.5" aria-hidden /> {drop.watching.toLocaleString("en-IN")}
                <span className="sr-only"> watching</span>
              </span>
            ) : null}
          </div>
          <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 text-[12px] font-semibold leading-5 text-white">
            {count(drop.items, "piece", "pieces")}
          </span>
        </Thumb>
      </Link>
      <DropMeta drop={drop}>
        <p className="mt-0.5 text-[13px] text-fg-2">
          {drop.claims > 0 ? count(drop.claims, "claim so far", "claims so far") : "Claims open now"}
        </p>
      </DropMeta>
    </article>
  );
}

/** An upcoming drop with its start time and a Remind me toggle. */
export function UpcomingCard({ drop, className, rail }: { drop: DropCard; className?: string; rail?: boolean }) {
  const now = useNow();
  const remind = useRemind(drop.slug, drop.shopName, drop.reminders);
  const soon = startsIn(drop.scheduledFor, now);
  return (
    <article role={rail ? "listitem" : undefined} className={cx("group min-w-0", rail && railItem, className)}>
      <Link to="/l/$slug" params={{ slug: drop.slug }} className="block rounded-xl" aria-label={`${drop.title}, ${drop.scheduledFor ? dropWhen(drop.scheduledFor) : "starting soon"}`}>
        <Thumb drop={drop}>
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 text-[12px] font-semibold leading-5 text-white">
            {drop.scheduledFor ? dropWhen(drop.scheduledFor) : "Starting soon"}
          </span>
          {soon ? (
            <span className="absolute bottom-2 left-2 rounded-md bg-accent px-1.5 text-[12px] font-bold leading-5 text-white">Starts {soon}</span>
          ) : null}
        </Thumb>
      </Link>
      <DropMeta drop={drop}>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[13px] text-fg-2">
            {remind.count > 0 ? count(remind.count, "person reminded", "people reminded") : count(drop.items, "piece", "pieces")}
          </p>
          <RemindButton remind={remind} />
        </div>
      </DropMeta>
    </article>
  );
}

export function RemindButton({ remind, block }: { remind: ReturnType<typeof useRemind>; block?: boolean }) {
  return (
    <button
      type="button"
      onClick={remind.press}
      disabled={remind.pending}
      aria-pressed={remind.reminded}
      className={cx(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition disabled:opacity-60",
        remind.reminded ? "bg-good-soft text-good hover:brightness-125" : "bg-white/10 text-fg hover:bg-white/15",
        block && "w-full",
      )}
    >
      {remind.reminded ? <BellRing className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
      {remind.reminded ? "Reminding you" : "Remind me"}
    </button>
  );
}

/** A drop that has ended. */
export function PastCard({ drop, className, rail }: { drop: DropCard; className?: string; rail?: boolean }) {
  return (
    <article role={rail ? "listitem" : undefined} className={cx("group min-w-0", rail && railItem, className)}>
      <Link to="/l/$slug" params={{ slug: drop.slug }} className="block rounded-xl" aria-label={`${drop.title}, ended`}>
        <Thumb drop={drop} dim>
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 text-[12px] font-semibold leading-5 text-white">
            {drop.endedAt ? `Ended ${inline(dropWhen(drop.endedAt, true))}` : "Ended"}
          </span>
        </Thumb>
      </Link>
      <DropMeta drop={drop}>
        <p className="mt-0.5 text-[13px] text-fg-2">
          {count(drop.items, "piece", "pieces")}, {count(drop.claims, "claim", "claims")}
        </p>
      </DropMeta>
    </article>
  );
}

/** The practice drop, shown at the end of the live row. */
export function PracticeCard({ className, rail }: { className?: string; rail?: boolean }) {
  return (
    <article role={rail ? "listitem" : undefined} className={cx("group min-w-0", rail && railItem, className)}>
      <Link to="/try" className="block rounded-xl" aria-label="Try a practice drop">
        <div className="tile relative flex aspect-video flex-col justify-end overflow-hidden rounded-xl bg-[linear-gradient(135deg,#3d1a29_0%,#252728_70%)] p-3">
          <div className="absolute -right-6 -top-6 size-28 rounded-full bg-accent/25 blur-2xl" aria-hidden />
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-gold px-1.5 text-[12px] font-bold leading-5 text-canvas">
            <Zap className="size-3" aria-hidden /> Practice
          </span>
          <p className="relative font-display text-[22px] font-bold leading-tight text-fg">Race four buyers for one piece</p>
          <p className="relative mt-1 text-[13px] text-fg-2">30 seconds. No sign-in, nobody is charged.</p>
        </div>
      </Link>
      <div className="mt-2.5 flex gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <Link to="/try" className="rounded text-[15px] font-semibold leading-snug text-fg hover:underline">
            Try a drop
          </Link>
          <p className="mt-0.5 text-[13px] text-fg-2">Scripted rivals, real claims and holds</p>
        </div>
      </div>
    </article>
  );
}

// --- Item tiles ----------------------------------------------------------------------------------

type Tone = "good" | "gold" | "muted" | "fg";
const toneClass: Record<Tone, string> = { good: "text-good", gold: "text-gold", muted: "text-muted", fg: "text-fg-2" };

/** What a pick's small status line says. */
export function pickStatus(pick: PickCard): { label: string; tone: Tone; soldOut: boolean } {
  if (pick.dropStatus === "ended") return { label: "Drop ended", tone: "muted", soldOut: pick.unitsLeft === 0 };
  if (pick.status === "closed") return pick.unitsLeft === 0 ? { label: "Sold out", tone: "muted", soldOut: true } : { label: "Claims closed", tone: "muted", soldOut: false };
  if (pick.dropStatus === "live") {
    if (pick.status === "open") {
      return pick.unitsLeft > 0
        ? { label: `${pick.unitsLeft} left, claim now`, tone: "good", soldOut: false }
        : { label: "All held, join the line", tone: "gold", soldOut: false };
    }
    return { label: "Up next in the live", tone: "fg", soldOut: false };
  }
  return { label: pick.dropScheduledFor ? `Drops ${inline(dropWhen(pick.dropScheduledFor, true))}` : "Drops soon", tone: "fg", soldOut: false };
}

export function PickTile({ pick }: { pick: PickCard }) {
  const status = pickStatus(pick);
  return (
    <Link to="/l/$slug" params={{ slug: pick.dropSlug }} className="group block min-w-0 rounded-lg" aria-label={`${pick.title}, ${priceLabel(pick.pricePaise)}, ${status.label}`}>
      <PhotoTile path={pick.imagePath} alt={pick.title} className={cx("[&>img]:transition [&>img]:duration-300 group-hover:[&>img]:scale-[1.03]", status.soldOut && "[&>img]:opacity-50")}>
        {pick.dropStatus === "live" && pick.status === "open" ? (
          <Badge tone="live" className="absolute left-2 top-2 rounded-md px-1.5">
            <LiveDot className="size-1.5" /> Live
          </Badge>
        ) : null}
        {status.soldOut ? (
          <span className="absolute left-2 top-2 rounded-md bg-black/75 px-1.5 text-[12px] font-bold leading-5 text-white">Sold out</span>
        ) : null}
      </PhotoTile>
      <TileText price={pick.pricePaise} title={pick.title} line={place(pick.shopName, pick.shopCity)} status={status} />
    </Link>
  );
}

function TileText({ price, title, line, status }: { price: number; title: string; line?: string; status: { label: string; tone: Tone } }) {
  return (
    <div className="pt-1.5">
      <p className="text-[17px] font-bold leading-6 text-fg">{priceLabel(price)}</p>
      <p className="truncate text-[15px] leading-5 text-fg">{title}</p>
      {line ? <p className="truncate text-[13px] leading-[18px] text-fg-2">{line}</p> : null}
      <p className={cx("truncate text-[13px] font-semibold leading-[18px]", toneClass[status.tone])}>{status.label}</p>
    </div>
  );
}

/** A catalogue item on a shop page. Links to the live room when the item is open in it. */
export function CatalogueTile({ item, liveSlug }: { item: ShopItem; liveSlug?: string }) {
  const soldOut = item.unitsLeft === 0 && item.status !== "open";
  const status: { label: string; tone: Tone } =
    item.status === "open"
      ? item.unitsLeft > 0
        ? { label: `${item.unitsLeft} left, claim now`, tone: "good" }
        : { label: "All held, join the line", tone: "gold" }
      : soldOut
        ? { label: "Sold out", tone: "muted" }
        : item.status === "closed"
          ? { label: "Not on sale right now", tone: "muted" }
          : { label: item.unitsLeft === 1 ? "One piece" : `${item.unitsLeft} pieces`, tone: "fg" };
  const body = (
    <>
      <PhotoTile path={item.imagePath} alt={item.title} className={cx(soldOut && "[&>img]:opacity-50")}>
        {soldOut ? <span className="absolute left-2 top-2 rounded-md bg-black/75 px-1.5 text-[12px] font-bold leading-5 text-white">Sold out</span> : null}
        <span className="absolute bottom-2 left-2 rounded-md bg-gold px-1.5 font-mono text-[12px] font-extrabold leading-5 text-canvas">{item.code}</span>
      </PhotoTile>
      <TileText price={item.pricePaise} title={item.title} status={status} />
    </>
  );
  if (liveSlug && item.status === "open") {
    return (
      <Link to="/l/$slug" params={{ slug: liveSlug }} className="block min-w-0 rounded-lg" aria-label={`${item.title}, claim in the live`}>
        {body}
      </Link>
    );
  }
  return <div className="min-w-0">{body}</div>;
}

export const tileGrid = "grid grid-cols-2 gap-x-2 gap-y-5 md:grid-cols-3 md:gap-x-3 lg:grid-cols-4 2xl:grid-cols-5";
/** Same as `tileGrid` for narrower pages that stop at four columns. */
export const tileGrid4 = "grid grid-cols-2 gap-x-2 gap-y-5 md:grid-cols-3 md:gap-x-3 lg:grid-cols-4";
export const cardGrid = "grid gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

// --- Skeletons -----------------------------------------------------------------------------------

export function CardSkeleton({ rail }: { rail?: boolean }) {
  return (
    <div className={cx("min-w-0", rail && railItem)} aria-hidden>
      <div className="aspect-video animate-pulse rounded-xl bg-surface-2" />
      <div className="mt-2.5 flex gap-2.5">
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-surface-2" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className="min-w-0" aria-hidden>
      <div className="aspect-square animate-pulse rounded-lg bg-surface-2" />
      <div className="space-y-1.5 pt-2">
        <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
        <div className="h-3.5 w-11/12 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}

export function RailSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="no-scrollbar -mx-3 flex gap-3 overflow-hidden px-3 sm:-mx-5 sm:px-5" aria-label="Loading" role="status">
      {Array.from({ length: n }, (_, i) => (
        <CardSkeleton key={i} rail />
      ))}
    </div>
  );
}

export function SectionSkeleton({ title }: { title?: boolean }) {
  return (
    <div className="space-y-3" aria-hidden>
      {title !== false ? <div className="h-5 w-32 animate-pulse rounded bg-surface-2" /> : null}
      <RailSkeleton />
    </div>
  );
}

// --- Category chips and phone search -------------------------------------------------------------

export function CategoryChips({ category, className }: { category?: string; className?: string }) {
  const chip = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold transition";
  return (
    <nav aria-label="Categories" className={cx("no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:-mx-5 sm:px-5", className)}>
      <Link to="/" className={cx(chip, !category ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg hover:bg-surface-3")} aria-current={!category ? "page" : undefined}>
        All
      </Link>
      {CATEGORIES.map(({ value, label, icon: Icon }) => (
        <Link
          key={value}
          to="/"
          search={{ category: value }}
          className={cx(chip, category === value ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg hover:bg-surface-3")}
          aria-current={category === value ? "page" : undefined}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function SearchPill({ initial, onSearch, className }: { initial?: string; onSearch: (q: string) => void; className?: string }) {
  const [value, setValue] = useState(initial ?? "");
  useEffect(() => setValue(initial ?? ""), [initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  };
  return (
    <form role="search" onSubmit={submit} className={className}>
      <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-fg-2 focus-within:ring-2 focus-within:ring-accent">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search drops, items and shops"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
          aria-label="Search drops, items and shops"
        />
      </label>
    </form>
  );
}

// --- Remind me -----------------------------------------------------------------------------------

const PENDING_REMIND = "pehle.remindAfterSignIn";

/**
 * "Remind me" for one upcoming drop. Signed-out visitors are asked to sign in first; the reminder
 * is switched on once they are back (also after Google's redirect).
 */
export function useRemind(slug: string, shopName: string, reminders: number) {
  const session = useSession();
  const buyer = buyerOf(session.data);
  const signIn = useSignIn();
  const toast = useToast();
  const queryClient = useQueryClient();
  // The browse card does not carry the viewer's own reminder, so ask the room once.
  const room = useQuery({
    queryKey: keys.room(slug),
    queryFn: () => unwrap(api.GET("/api/v1/rooms/{slug}", { params: { path: { slug } } })),
    enabled: Boolean(buyer),
    staleTime: 60_000,
  });
  const toggle = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/rooms/{slug}/remind", { params: { path: { slug } } })),
    onSuccess: ({ reminded }) => {
      queryClient.setQueryData(keys.room(slug), (old: typeof room.data) =>
        old ? { ...old, reminded, reminders: Math.max(0, old.reminders + (reminded ? 1 : -1)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ["browse"] });
      void queryClient.invalidateQueries({ queryKey: ["shop-page"] });
      toast(reminded ? `We'll tell you when ${shopName} goes live` : "Reminder turned off", reminded ? "success" : "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const { mutate } = toggle;
  const reminded = room.data?.reminded ?? false;
  const roomReady = Boolean(room.data);
  useEffect(() => {
    if (!buyer || !roomReady) return;
    if (window.sessionStorage.getItem(PENDING_REMIND) !== slug) return;
    window.sessionStorage.removeItem(PENDING_REMIND);
    if (!reminded) mutate();
  }, [buyer, roomReady, reminded, slug, mutate]);
  const press = () => {
    if (!buyer) {
      window.sessionStorage.setItem(PENDING_REMIND, slug);
      signIn({
        title: "Get a reminder",
        reason: `Sign in and we'll tell you the moment ${shopName} goes live. Pehle never shares your number or email with the shop.`,
      });
      return;
    }
    toggle.mutate();
  };
  return { reminded, press, pending: toggle.isPending, count: room.data?.reminders ?? reminders };
}

// --- Small bits ----------------------------------------------------------------------------------

export function CopyButton({ text, label = "Copy", done = "Copied" }: { text: string; label?: string; done?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => toast(done, "success"),
          () => toast("Copy failed. Select the text and copy it instead.", "error"),
        );
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[13px] font-semibold text-fg hover:bg-white/15"
    >
      <Copy className="size-3.5" aria-hidden /> {label}
    </button>
  );
}

/** The private note a winner receives (coupon code, link, delivery details). */
export function WinnerNote({ note, shopName, heading }: { note: string; shopName: string; heading?: string }) {
  return (
    <div className="rounded-xl border border-good/25 bg-good-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-good">{heading ?? `From ${shopName}, only for you`}</p>
        <CopyButton text={note} done="Note copied" />
      </div>
      <p className="mt-1.5 select-all whitespace-pre-line break-words text-[15px] text-fg">{note}</p>
    </div>
  );
}

export function ClubCount({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-fg-2">
      <Users className="size-3.5" aria-hidden /> {count(n, "club member", "club members")}
    </span>
  );
}
