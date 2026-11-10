import { Link, createFileRoute } from "@tanstack/react-router";
import { BarChart3, CalendarClock, ChevronRight, Plus, Radio } from "lucide-react";
import type { ReactNode } from "react";

import { RunAgainButton } from "~/components/studio/drop-editor";
import { PageHeader, SectionTitle } from "~/components/studio/bits";
import { groupLives, useLives } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { countdownText, dropTime } from "~/components/studio/time";
import { Badge, Button, Empty, LiveDot, PageSpinner, cx, errorMessage, useCountdown } from "~/components/ui";
import type { Live } from "~/lib/api";
import { streamHost, timeAgo } from "~/lib/format";

export const Route = createFileRoute("/studio/drops/")({
  component: DropsPage,
});

function DropsPage() {
  const { shop } = useShop();
  const lives = useLives(shop.id);
  const { live, upcoming, past } = groupLives(lives.data);
  const create = (
    <Link to="/studio/drops/new">
      <Button>
        <Plus className="size-4" /> Create drop
      </Button>
    </Link>
  );

  if (lives.isPending) return <PageSpinner />;
  if (lives.isError) return <Empty title="Couldn't load your drops">{errorMessage(lives.error)}</Empty>;

  return (
    <div className="space-y-6">
      <PageHeader title="Drops" subtitle="Announce a drop, share one link, then go live and open items one at a time." actions={lives.data.length ? create : null} />

      {lives.data.length === 0 ? <Empty title="Create your first drop to get a link you can share." action={create} /> : null}

      {live.length ? (
        <section>
          <SectionTitle>Live now</SectionTitle>
          <div className="space-y-2">
            {live.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 shadow-surface ring-1 ring-inset ring-live/40 sm:p-4">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-live text-white">
                  <Radio className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <Badge tone="live">
                    <LiveDot /> Live
                  </Badge>
                  <p className="mt-0.5 truncate text-[17px] font-semibold">{l.title}</p>
                  <p className="text-[13px] text-fg-2">Started {l.startedAt ? timeAgo(l.startedAt) : "just now"}</p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Link to="/studio/drops/$liveId" params={{ liveId: l.id }} className="flex-1 sm:flex-none">
                    <Button variant="secondary" block>
                      Share kit
                    </Button>
                  </Link>
                  <Link to="/studio/live/$liveId" params={{ liveId: l.id }} className="flex-1 sm:flex-none">
                    <Button block>Resume console</Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {upcoming.length ? (
        <section>
          <SectionTitle>Upcoming</SectionTitle>
          <ul className="overflow-hidden rounded-xl bg-surface shadow-surface">
            {upcoming.map((l) => (
              <DropRow key={l.id} live={l} detail={<UpcomingDetail live={l} />} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section>
          <SectionTitle>Past</SectionTitle>
          <ul className="overflow-hidden rounded-xl bg-surface shadow-surface">
            {past.map((l) => (
              <DropRow
                key={l.id}
                live={l}
                to="report"
                detail={<span>Ended {l.endedAt ? timeAgo(l.endedAt) : ""}</span>}
                actions={
                  <>
                    <Link to="/studio/drops/$liveId/report" params={{ liveId: l.id }} className="hidden sm:block">
                      <Button variant="secondary" size="sm">
                        <BarChart3 className="size-4" /> Report
                      </Button>
                    </Link>
                    <span className="hidden sm:block">
                      <RunAgainButton live={l} variant="secondary" />
                    </span>
                  </>
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function UpcomingDetail({ live }: { live: Live }) {
  const left = useCountdown(live.scheduledFor);
  if (!live.scheduledFor) return <span>No start time yet</span>;
  return (
    <span>
      {dropTime(live.scheduledFor)}
      {left > 0 ? <span className="text-gold">, in {countdownText(left)}</span> : <span className="text-gold">, starting soon</span>}
    </span>
  );
}

function DateBlock({ live }: { live: Live }) {
  const iso = live.status === "ended" ? (live.endedAt ?? live.createdAt) : live.scheduledFor;
  if (!iso) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
        <CalendarClock className="size-5" />
      </span>
    );
  }
  const d = new Date(iso);
  return (
    <span className={cx("flex size-12 shrink-0 flex-col items-center justify-center rounded-lg leading-none", live.status === "ended" ? "bg-surface-3 text-fg-2" : "bg-gold-soft text-gold")}>
      <span className="font-display text-[19px] font-bold">{d.getDate()}</span>
      <span className="mt-0.5 text-[11px] font-semibold">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
    </span>
  );
}

function DropRow({ live, detail, actions, to = "edit" }: { live: Live; detail: ReactNode; actions?: ReactNode; to?: "edit" | "report" }) {
  const host = streamHost(live.streamUrl);
  const hostLabel = host === "youtube" ? "YouTube" : host === "instagram" ? "Instagram" : host === "facebook" ? "Facebook" : host ? "Stream link" : null;
  const body = (
    <>
      <DateBlock live={live} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{live.title}</p>
        <p className="truncate text-[13px] text-fg-2">
          {detail}
          {hostLabel ? `, ${hostLabel}` : ""}
        </p>
      </div>
    </>
  );
  return (
    <li className="flex items-center gap-2 border-b border-line px-2 py-2 last:border-b-0 sm:px-3">
      {to === "report" ? (
        <Link to="/studio/drops/$liveId/report" params={{ liveId: live.id }} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-white/5">
          {body}
        </Link>
      ) : (
        <Link to="/studio/drops/$liveId" params={{ liveId: live.id }} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-white/5">
          {body}
        </Link>
      )}
      {actions}
      <ChevronRight className="size-5 shrink-0 text-muted sm:hidden" aria-hidden />
    </li>
  );
}
