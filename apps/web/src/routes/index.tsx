import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Store, X, Zap } from "lucide-react";
import { useState } from "react";

import {
  CategoryChips,
  LiveCard,
  PastCard,
  PickTile,
  PracticeCard,
  Rail,
  RailSkeleton,
  SearchPill,
  Section,
  SeeAll,
  TileSkeleton,
  UpcomingCard,
  count,
  linkButton,
  tileGrid,
  useBrowse,
} from "~/components/browse";
import { LiveFeed } from "~/components/live-feed";
import { AppShell, BrowseSidebar, categoryLabel } from "~/components/shell";
import { type BrowseFeed } from "~/lib/api";
import { useSession } from "~/lib/session";

interface BrowseSearch {
  category?: string;
  q?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): BrowseSearch => ({
    category: typeof search.category === "string" && search.category ? search.category : undefined,
    q: typeof search.q === "string" && search.q.trim() ? search.q.trim().slice(0, 60) : undefined,
  }),
  component: Browse,
});

function Browse() {
  const { category, q } = Route.useSearch();
  const navigate = useNavigate();
  const feed = useBrowse(category, q);
  const filtered = Boolean(category || q);
  return (
    <AppShell sidebar={<BrowseSidebar category={category} />}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <WelcomeBanner />
        <div className="space-y-3 xl:hidden">
          <SearchPill
            key={q ?? ""}
            initial={q}
            className="md:hidden"
            onSearch={(value) => void navigate({ to: "/", search: value ? { q: value, category } : { category } })}
          />
          <CategoryChips category={category} />
        </div>
        {filtered ? <Filtered feed={feed.data} loading={feed.isPending} category={category} q={q} /> : <Feed feed={feed.data} loading={feed.isPending} />}
      </div>
    </AppShell>
  );
}

const BANNER_KEY = "pehle.welcomeDismissed";

/** One line for first-time visitors who are not signed in. */
function WelcomeBanner() {
  const session = useSession();
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(BANNER_KEY) === "1");
  const signedIn = session.data && session.data.me.kind !== "anonymous";
  if (dismissed || signedIn) return null;
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface p-4 shadow-surface sm:p-5">
      <div className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full bg-accent/20 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-3 pr-8 md:flex-row md:items-center md:justify-between md:gap-6">
        <p className="text-balance font-display text-[20px] font-bold leading-snug text-fg sm:text-[22px]">
          Fair drops from India's live sellers. <span className="text-accent">First to claim gets it.</span>
        </p>
        <div className="flex flex-wrap gap-2 md:shrink-0 md:flex-nowrap">
          <Link to="/try" className={linkButton("primary", "md", "shadow-glow")}>
            <Zap className="size-4" /> Try a drop in 30 seconds
          </Link>
          <Link to="/sell" className={linkButton("soft")}>
            <Store className="size-4" /> Sell on Pehle
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(BANNER_KEY, "1");
          setDismissed(true);
        }}
        className="absolute right-2 top-2 rounded-full p-1.5 text-fg-2 hover:bg-white/10 hover:text-fg"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function Feed({ feed, loading }: { feed?: BrowseFeed; loading: boolean }) {
  const session = useSession();
  const demo = session.data?.demo ?? false;
  if (loading || !feed) {
    return (
      <div className="space-y-8">
        <SkeletonSection />
        <SkeletonSection />
        <div className="space-y-3">
          <div className="h-5 w-36 animate-pulse rounded bg-surface-2" />
          <div className={tileGrid}>
            {Array.from({ length: 8 }, (_, i) => (
              <TileSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const nothing = !feed.live.length && !feed.upcoming.length && !feed.picks.length && !feed.recent.length;
  return (
    <div className="space-y-8">
      <LiveFeed />
      <Section
        title="Live now"
        id="live-now"
        sub={feed.live.length ? "Claim inside the room. The first claim gets it." : "Nobody is live right now. Practise on the demo drop while you wait."}
        action={feed.live.length > 3 ? <SeeAll to="/live" /> : null}
      >
        <Rail label="Live drops">
          {feed.live.map((drop) => (
            <LiveCard key={drop.id} drop={drop} rail />
          ))}
          {demo ? <PracticeCard rail /> : null}
        </Rail>
      </Section>

      {feed.upcoming.length ? (
        <Section title="Starting soon" id="starting-soon" sub="Tap Remind me and we'll tell you when it starts.">
          <Rail label="Upcoming drops">
            {feed.upcoming.map((drop) => (
              <UpcomingCard key={drop.id} drop={drop} rail />
            ))}
          </Rail>
        </Section>
      ) : null}

      {feed.picks.length ? (
        <Section title="Today's picks" id="picks" sub="Pieces you can claim now or in an upcoming drop.">
          <div className={tileGrid}>
            {feed.picks.map((pick) => (
              <PickTile key={pick.itemId} pick={pick} />
            ))}
          </div>
        </Section>
      ) : null}

      {feed.recent.length ? (
        <Section title="Recent drops" id="recent" sub="Every decision in these drops is in their public fairness log.">
          <Rail label="Recent drops">
            {feed.recent.map((drop) => (
              <PastCard key={drop.id} drop={drop} rail />
            ))}
          </Rail>
        </Section>
      ) : null}

      {nothing ? (
        <p className="rounded-xl bg-surface px-4 py-6 text-center text-fg-2 shadow-surface">
          No shops have scheduled drops yet.{" "}
          <Link to="/sell" className="font-semibold text-info hover:underline">
            Run the first one
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="space-y-3">
      <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
      <RailSkeleton />
    </div>
  );
}

function Filtered({ feed, loading, category, q }: { feed?: BrowseFeed; loading: boolean; category?: string; q?: string }) {
  const heading = q ? `Results for “${q}”` : categoryLabel(category);
  const scope = q && category ? `in ${categoryLabel(category)}` : null;
  const total = feed ? feed.live.length + feed.upcoming.length + feed.picks.length + feed.recent.length : 0;
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words font-display text-[28px] font-bold leading-tight">{heading}</h1>
          <p className="mt-0.5 text-[15px] text-fg-2">{loading || !feed ? "Looking…" : summary(feed, scope)}</p>
        </div>
        <Link to="/" className={linkButton("secondary")}>
          Browse all
        </Link>
      </div>

      {loading || !feed ? (
        <div className={tileGrid}>
          {Array.from({ length: 8 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface px-6 py-12 text-center shadow-surface">
          <p className="text-[17px] font-semibold">{q ? `Nothing matches “${q}” yet` : `No ${categoryLabel(category).toLowerCase()} drops yet`}</p>
          <p className="max-w-sm text-[15px] text-fg-2">
            {q ? "Try a shorter word, a shop name or an item code like S12." : "New shops join every week. Browse everything that is on now."}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link to="/" className={linkButton("secondary")}>
              Browse all drops
            </Link>
            <Link to="/try" className={linkButton("soft")}>
              Try a practice drop
            </Link>
          </div>
        </div>
      ) : (
        <>
          {feed.live.length ? (
            <Section title="Live now" id="f-live">
              <Rail label="Live drops">
                {feed.live.map((drop) => (
                  <LiveCard key={drop.id} drop={drop} rail />
                ))}
              </Rail>
            </Section>
          ) : null}
          {feed.upcoming.length ? (
            <Section title="Starting soon" id="f-upcoming">
              <Rail label="Upcoming drops">
                {feed.upcoming.map((drop) => (
                  <UpcomingCard key={drop.id} drop={drop} rail />
                ))}
              </Rail>
            </Section>
          ) : null}
          {feed.picks.length ? (
            <Section title={q ? "Pieces" : `${categoryLabel(category)} to claim`} id="f-picks">
              <div className={tileGrid}>
                {feed.picks.map((pick) => (
                  <PickTile key={pick.itemId} pick={pick} />
                ))}
              </div>
            </Section>
          ) : null}
          {feed.recent.length ? (
            <Section title="Recent drops" id="f-recent">
              <Rail label="Recent drops">
                {feed.recent.map((drop) => (
                  <PastCard key={drop.id} drop={drop} rail />
                ))}
              </Rail>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function summary(feed: BrowseFeed, scope: string | null): string {
  const parts: string[] = [];
  if (feed.live.length) parts.push(count(feed.live.length, "live drop", "live drops"));
  if (feed.upcoming.length) parts.push(count(feed.upcoming.length, "upcoming drop", "upcoming drops"));
  if (feed.picks.length) parts.push(count(feed.picks.length, "piece", "pieces"));
  if (feed.recent.length) parts.push(count(feed.recent.length, "past drop", "past drops"));
  const found = parts.length ? parts.join(", ") : "Nothing yet";
  return scope ? `${found} ${scope}` : found;
}
