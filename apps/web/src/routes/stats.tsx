import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";

import { AppShell } from "~/components/shell";
import { Card, PageSpinner } from "~/components/ui";
import { api, keys, unwrap } from "~/lib/api";
import { rupees } from "~/lib/format";

export const Route = createFileRoute("/stats")({ component: StatsPage });

/** The public usage record: every number comes from the decision log and Nexconn's own webhooks. */
function StatsPage() {
  const stats = useQuery({
    queryKey: keys.stats,
    queryFn: () => unwrap(api.GET("/api/v1/stats")),
    refetchInterval: 10_000,
  });
  const s = stats.data;
  const tiles = s
    ? [
        { label: "People connected to live chat", value: s.chatUsers, note: "Signed in or watching, counted from Nexconn connection events" },
        { label: "People who entered a drop room", value: s.roomVisitors, note: "From Nexconn's open channel join events" },
        { label: "Buyers who claimed", value: s.buyersWhoClaimed, note: `${s.claims.toLocaleString("en-IN")} claims decided in order` },
        { label: "Moved up the line automatically", value: s.waitlistPromotions, note: "Someone ahead didn't pay, so the next person got it" },
        { label: "Orders paid or won", value: s.ordersPaid, note: `${rupees(s.revenuePaise)} paid straight to sellers` },
        { label: "Shops", value: s.shops, note: `${s.lives.toLocaleString("en-IN")} drops run, ${s.followers.toLocaleString("en-IN")} club members` },
      ]
    : [];
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5 py-4">
        <header className="space-y-2">
          <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-accent">
            <Activity className="size-4" /> Live usage
          </p>
          <h1 className="font-display text-[32px] font-bold leading-tight">How Pehle is being used</h1>
          <p className="max-w-2xl text-fg-2">
            These numbers update every few seconds from Pehle's decision log and from Nexconn's own webhooks. Nothing here is typed in by
            hand, and scripted rivals in the demo shop never connect to chat, so they are never counted as people.
          </p>
        </header>
        {stats.isPending ? (
          <PageSpinner />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <Card key={t.label} className="space-y-1 p-5">
                <p className="text-[14px] font-semibold text-fg-2">{t.label}</p>
                <p className="tabular font-display text-[40px] font-bold leading-none">{t.value.toLocaleString("en-IN")}</p>
                <p className="text-[13px] text-muted">{t.note}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
