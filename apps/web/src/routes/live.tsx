import { Link, createFileRoute } from "@tanstack/react-router";
import { Bell } from "lucide-react";

import { CardSkeleton, LiveCard, PracticeCard, Section, UpcomingCard, cardGrid, dropWhen, inline, linkButton, useBrowse } from "~/components/browse";
import { AppShell, BrowseSidebar } from "~/components/shell";
import { useSession } from "~/lib/session";

export const Route = createFileRoute("/live")({ component: LiveNow });

function LiveNow() {
  const feed = useBrowse();
  const session = useSession();
  const demo = session.data?.demo ?? false;
  const live = feed.data?.live ?? [];
  const upcoming = feed.data?.upcoming ?? [];
  const next = upcoming[0];
  return (
    <AppShell sidebar={<BrowseSidebar />}>
      <div className="mx-auto max-w-[1600px] space-y-8">
        <div>
          <h1 className="font-display text-[28px] font-bold leading-tight">Live now</h1>
          <p className="mt-1 text-[15px] text-fg-2">Open a room to watch and claim. The server decides who was first, not the chat.</p>
        </div>

        {feed.isPending ? (
          <div className={cardGrid}>
            {Array.from({ length: 6 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
            {live.length === 0 ? (
              <div className="flex flex-col gap-3 rounded-xl bg-surface p-5 shadow-surface sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[17px] font-semibold">Nobody is live right now</p>
                  <p className="mt-0.5 text-[15px] text-fg-2">
                    {next?.scheduledFor
                      ? `${next.shopName} goes live ${inline(dropWhen(next.scheduledFor))}. Tap Remind me below and we'll tell you.`
                      : "Join a shop's club and you'll hear first when it goes live."}
                  </p>
                </div>
                {next ? (
                  <a href="#upcoming" className={linkButton("secondary", "md", "shrink-0")}>
                    <Bell className="size-4" /> See what's coming
                  </a>
                ) : (
                  <Link to="/" className={linkButton("secondary", "md", "shrink-0")}>
                    Browse shops
                  </Link>
                )}
              </div>
            ) : null}
            {live.length || demo ? (
              <div className={cardGrid} role="list" aria-label="Live drops">
                {live.map((drop) => (
                  <div role="listitem" key={drop.id} className="min-w-0">
                    <LiveCard drop={drop} />
                  </div>
                ))}
                {demo ? (
                  <div role="listitem" className="min-w-0">
                    <PracticeCard />
                  </div>
                ) : null}
              </div>
            ) : null}

            {upcoming.length ? (
              <div id="upcoming" className="scroll-mt-20">
                <Section title="Starting soon" id="upcoming-title" sub="Tap Remind me and we'll tell you the moment it starts.">
                  <div className={cardGrid}>
                    {upcoming.map((drop) => (
                      <UpcomingCard key={drop.id} drop={drop} />
                    ))}
                  </div>
                </Section>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
