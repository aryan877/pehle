import { Link } from "@tanstack/react-router";
import { Radio, Sparkles, Trophy } from "lucide-react";

import { mediaUrl, rupees, timeAgo } from "~/lib/format";
import type { Payload } from "~/lib/chat";
import { useSession } from "~/lib/session";
import { useOpenChannel } from "~/lib/useChat";

import { cx } from "./ui";

type Activity = Extract<Payload, { t: "activity" }>;

/** The Pehle-wide activity channel the server posts to. */
const LOBBY = "lobby";

/**
 * "Happening now": drops starting, pieces dropping and people winning across Pehle, pushed live
 * through a Nexconn open channel. Hidden until there is something to show.
 */
export function LiveFeed({ className }: { className?: string }) {
  const session = useSession();
  const lobby = useOpenChannel(LOBBY, Boolean(session.data?.chatLive));
  const items = lobby.messages
    .flatMap((m) => (m.payload?.t === "activity" ? [{ id: m.id, at: m.sentTime, text: m.text, activity: m.payload }] : []))
    .slice(-6)
    .reverse();
  if (items.length === 0) return null;
  return (
    <section className={cx("rounded-xl bg-surface p-3 shadow-surface", className)} aria-label="Happening now on Pehle">
      <p className="flex items-center gap-2 px-1 pb-2 text-[15px] font-semibold">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live/70" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>
        Happening now
      </p>
      <ul className="no-scrollbar flex gap-2 overflow-x-auto">
        {items.map(({ id, at, text, activity }) => (
          <li key={id} className="min-w-[240px] max-w-[300px] flex-1 animate-rise">
            <Link
              to="/l/$slug"
              params={{ slug: activity.slug }}
              className="flex items-center gap-2.5 rounded-lg bg-surface-2 p-2 hover:bg-surface-3"
            >
              {activity.imageUrl ? (
                <img src={mediaUrl(activity.imageUrl) ?? activity.imageUrl} alt="" className="size-11 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-3">
                  <Icon kind={activity.kind} />
                </span>
              )}
              <span className="min-w-0">
                <span className="line-clamp-2 text-[13px] leading-snug text-fg">{text}</span>
                <span className="text-[12px] text-muted">
                  {activity.kind === "drop" && activity.pricePaise !== undefined
                    ? `${activity.pricePaise === 0 ? "Free" : rupees(activity.pricePaise)}, ${timeAgo(new Date(at).toISOString())}`
                    : timeAgo(new Date(at).toISOString())}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Icon({ kind }: { kind: Activity["kind"] }) {
  if (kind === "live") return <Radio className="size-5 text-live" />;
  if (kind === "won") return <Trophy className="size-5 text-gold" />;
  return <Sparkles className="size-5 text-accent" />;
}
