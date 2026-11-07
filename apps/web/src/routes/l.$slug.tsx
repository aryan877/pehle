import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { EndedRoom } from "~/components/room/ended";
import { DesktopLiveRoom, PhoneLiveRoom } from "~/components/room/live-room";
import { useIsDesktop, useRoomModel } from "~/components/room/model";
import { UpcomingRoom } from "~/components/room/upcoming";
import { AppShell } from "~/components/shell";
import { PageSpinner } from "~/components/ui";

interface RoomSearch {
  /** Show the judges' coach that walks through a race in the demo shop. */
  demo?: 1;
}

export const Route = createFileRoute("/l/$slug")({
  validateSearch: (search: Record<string, unknown>): RoomSearch =>
    search.demo === 1 || search.demo === "1" || search.demo === true ? { demo: 1 } : {},
  component: Room,
});

/**
 * The drop room: the link a seller pins during their YouTube or Instagram live. Upcoming drops show
 * a countdown and Remind me; live drops are the stream-first claim room; ended drops summarise.
 */
function Room() {
  const { slug } = Route.useParams();
  const { demo } = Route.useSearch();
  const { model, pending, error } = useRoomModel(slug, demo === 1);
  const desktop = useIsDesktop();

  const title = model ? `${model.data.shop.displayName}: ${model.data.live.title}` : null;
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} on Pehle`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  if (pending) return <PageSpinner />;
  if (error || !model) {
    return (
      <AppShell>
        <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-display text-2xl font-bold">This live link doesn't work</p>
          <p className="text-muted">Check the link the shop shared, or ask them for a new one.</p>
          <Link to="/live" className="mt-2 font-semibold text-accent hover:underline">
            See who is live now
          </Link>
        </div>
      </AppShell>
    );
  }
  if (model.status === "draft") {
    return (
      <AppShell>
        <UpcomingRoom model={model} />
      </AppShell>
    );
  }
  if (model.status === "ended") {
    return (
      <AppShell>
        <EndedRoom model={model} />
      </AppShell>
    );
  }
  return desktop ? <DesktopLiveRoom model={model} /> : <PhoneLiveRoom model={model} />;
}
