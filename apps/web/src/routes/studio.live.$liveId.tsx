import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowUp, Ban, BarChart3, BadgeCheck, Bot, CircleStop, ImageIcon, MessageCircle, Play, QrCode, SkipForward, Sparkles, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ChatFeed, PreviewClaimsFeed, type NameOf } from "~/components/chat-feed";
import { CancelOrderSheet, ClaimStatusBadge, CopyButton, OrderStatusBadge, Segmented, priceLabel } from "~/components/studio/bits";
import { useApprovals, useConsole, useLineup, useOpenOrders } from "~/components/studio/queries";
import { shareMessage } from "~/components/studio/share-kit";
import { useShop } from "~/components/studio/shop-context";
import { Badge, Button, CodeChip, Empty, Input, LiveDot, PageSpinner, Sheet, Textarea, WhatsAppIcon, cx, errorMessage, useCountdown, useToast } from "~/components/ui";
import { api, keys, unwrap, type Approval, type ItemWithCounts, type LiveConsole, type OrderView, type QueueEntry } from "~/lib/api";
import { clock, mediaUrl, timeAgo, timeOfDay } from "~/lib/format";
import type { Snapshot } from "~/lib/session";
import { useOpenChannel } from "~/lib/useChat";

export const Route = createFileRoute("/studio/live/$liveId")({
  component: ConsolePage,
});

type MobileTab = "items" | "queue" | "chat";

function ConsolePage() {
  const { liveId } = Route.useParams();
  const { shop, chatLive } = useShop();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MobileTab>("queue");

  const consoleQuery = useConsole(liveId, 3_000);
  const orders = useOpenOrders(shop.id, 4_000);
  const approvals = useApprovals(shop.id, 5_000);
  const lineup = useLineup(liveId);

  const data = consoleQuery.data;
  const channel = useOpenChannel(data?.live.nexconnChannelId ?? null, chatLive && data?.live.status === "live");

  // New room messages usually mean a claim was just decided: refresh the queue now.
  const lastMessageId = channel.messages.at(-1)?.id;
  useEffect(() => {
    if (lastMessageId) void queryClient.invalidateQueries({ queryKey: keys.console(liveId) });
  }, [lastMessageId, liveId, queryClient]);

  // The lineup in its announced order, with fresh counts from the console. Then the next one to open.
  const ordered = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.items.map((i) => [i.id, i]));
    return (lineup.data ?? []).map((i) => byId.get(i.id)).filter((i): i is ItemWithCounts => Boolean(i));
  }, [data, lineup.data]);
  const next = useMemo(() => {
    const pool = ordered.length ? ordered : [...(data?.items ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return pool.find((i) => i.status === "ready" && i.unitsLeft > 0) ?? null;
  }, [ordered, data?.items]);

  if (consoleQuery.isPending) return <PageSpinner />;
  if (consoleQuery.isError || !data) {
    return (
      <Empty
        title="Couldn't open this drop"
        action={
          <Link to="/studio/drops">
            <Button variant="secondary">Back to drops</Button>
          </Link>
        }
      >
        {consoleQuery.error ? errorMessage(consoleQuery.error) : null}
      </Empty>
    );
  }

  const reported = (orders.data ?? []).filter((o) => o.liveId === data.live.id && o.status === "payment_reported");
  const pendingApprovals = (approvals.data ?? []).filter((a) => !a.liveId || a.liveId === data.live.id);

  return (
    <div className="mx-auto max-w-[1800px] space-y-3">
      <ConsoleHeader console={data} next={next} lineupCount={ordered.length} />

      <Segmented<MobileTab>
        className="lg:hidden"
        label="Console sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "queue", label: "Queue", count: reported.length },
          { value: "items", label: "Items" },
          { value: "chat", label: "Chat", count: pendingApprovals.length },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[340px_minmax(0,1fr)_400px]">
        <div className={cx("min-w-0", tab !== "items" && "hidden lg:block")}>
          <ItemsRail console={data} lineup={ordered} />
        </div>
        <div className={cx("min-w-0 space-y-3", tab !== "queue" && "hidden lg:block")}>
          {reported.length ? <PaymentChecks orders={reported} liveId={liveId} /> : null}
          <Pinned console={data} />
          <NextUp console={data} next={next} lineupCount={ordered.length} />
          <Queues console={data} />
        </div>
        <div className={cx("min-w-0 space-y-3", tab !== "chat" && "hidden lg:block")}>
          {pendingApprovals.length ? <Approvals approvals={pendingApprovals} /> : null}
          <ChatPanel console={data} channel={channel} chatLive={chatLive} />
        </div>
      </div>
    </div>
  );
}

// --- Drop and close items ------------------------------------------------------------------------

function useItemActions(liveId: string) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.console(liveId) }),
      queryClient.invalidateQueries({ queryKey: keys.items(shop.id) }),
      queryClient.invalidateQueries({ queryKey: keys.lineup(liveId) }),
    ]);
  const drop = useMutation({
    mutationFn: (itemId: string) => unwrap(api.POST("/api/v1/lives/{live_id}/drop", { params: { path: { live_id: liveId } }, body: { itemId } })),
    onSuccess: async (item) => {
      await refresh();
      toast(`${item.code} is up. Buyers can claim it now.`, "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const close = useMutation({
    mutationFn: (itemId: string) => unwrap(api.POST("/api/v1/lives/{live_id}/close", { params: { path: { live_id: liveId } }, body: { itemId } })),
    onSuccess: async (item) => {
      await refresh();
      toast(`${item.code} closed. Holds and the line stay.`, "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return { drop, close };
}

// --- Header -------------------------------------------------------------------------------------

function ConsoleHeader({ console: data, next, lineupCount }: { console: LiveConsole; next: ItemWithCounts | null; lineupCount: number }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const live = data.live;
  const { drop } = useItemActions(live.id);
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: keys.console(live.id) }), queryClient.invalidateQueries({ queryKey: keys.lives(shop.id) })]);

  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/lives/{live_id}/start", { params: { path: { live_id: live.id } } })),
    onSuccess: async () => {
      await refresh();
      toast("You're live. Share the room link with your viewers.", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const end = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/lives/{live_id}/end", { params: { path: { live_id: live.id } } })),
    onSuccess: async () => {
      setConfirmEnd(false);
      await refresh();
      toast("Drop ended. Holds and the line keep running until they're paid or expire.", "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface p-2.5 shadow-surface sm:p-3">
      <Link
        to="/studio/drops"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg hover:bg-white/15"
        aria-label="Back to drops"
      >
        <ArrowLeft className="size-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {live.status === "live" ? (
            <Badge tone="live">
              <LiveDot /> Live
            </Badge>
          ) : live.status === "draft" ? (
            <Badge tone="wait">Not started</Badge>
          ) : (
            <Badge tone="muted">Ended</Badge>
          )}
          {live.startedAt && live.status === "live" ? <span className="truncate text-[13px] text-fg-2">since {timeOfDay(live.startedAt)}</span> : null}
        </div>
        <h1 className="truncate font-display text-[20px] font-bold leading-tight sm:text-[22px]">{live.title}</h1>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Button variant="secondary" onClick={() => setSharing(true)} className="flex-1 sm:flex-none">
          <QrCode className="size-4" /> Share
        </Button>
        {live.status === "draft" ? (
          <Button loading={start.isPending} onClick={() => start.mutate()} className="flex-1 sm:flex-none">
            <Play className="size-4" /> Go live
          </Button>
        ) : live.status === "live" ? (
          <>
            {next ? (
              <span className="hidden lg:block">
                <Button loading={drop.isPending && drop.variables === next.id} onClick={() => drop.mutate(next.id)}>
                  <SkipForward className="size-4" /> Open next: {next.code}
                </Button>
              </span>
            ) : null}
            <Button variant="danger" onClick={() => setConfirmEnd(true)} className="flex-1 sm:flex-none">
              <CircleStop className="size-4" /> End drop
            </Button>
          </>
        ) : (
          <Link to="/studio/drops/$liveId/report" params={{ liveId: live.id }} className="flex-1 sm:flex-none">
            <Button block>
              <BarChart3 className="size-4" /> See report
            </Button>
          </Link>
        )}
      </div>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} url={data.roomUrl} console={data} itemCount={lineupCount} shopName={shop.displayName} />
      <Sheet open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this drop?">
        <div className="space-y-4">
          <p className="text-fg-2">No new claims after this. People holding items can still pay, and the line keeps moving if they don't.</p>
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setConfirmEnd(false)}>
              Keep going
            </Button>
            <Button block loading={end.isPending} onClick={() => end.mutate()}>
              End drop
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function ShareSheet({
  open,
  onClose,
  url,
  console: data,
  itemCount,
  shopName,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  console: LiveConsole;
  itemCount: number;
  shopName: string;
}) {
  const message = shareMessage({ shopName, live: data.live, url, itemCount });
  return (
    <Sheet open={open} onClose={onClose} title="Share the room">
      <div className="space-y-4">
        <div className="mx-auto w-fit rounded-xl bg-white p-3">
          <QRCodeSVG value={url} size={200} marginSize={1} fgColor="#1c1c1d" />
        </div>
        <p className="text-center text-[14px] text-fg-2">Show this on stream, or send the link.</p>
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[14px]">{url.replace(/^https?:\/\//, "")}</span>
          <CopyButton text={url} label="Copy link" />
        </div>
        <div className="flex gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1fa855] text-[15px] font-semibold text-white transition hover:brightness-110"
          >
            <WhatsAppIcon className="size-[18px]" /> WhatsApp
          </a>
          <CopyButton text={message} label="Copy message" size="lg" className="flex-1" />
        </div>
      </div>
    </Sheet>
  );
}

// --- Items rail ---------------------------------------------------------------------------------

function ItemsRail({ console: data, lineup }: { console: LiveConsole; lineup: ItemWithCounts[] }) {
  const live = data.live;
  const isLive = live.status === "live";
  const inLineup = new Set(lineup.map((i) => i.id));
  const others = [...data.items]
    .filter((i) => !inLineup.has(i.id))
    .sort((a, b) => rank(a, live.pinnedItemId) - rank(b, live.pinnedItemId) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const { drop, close } = useItemActions(live.id);

  const row = (item: ItemWithCounts, position?: number) => {
    const pinned = item.id === live.pinnedItemId;
    const openHere = item.status === "open" && item.openLiveId === live.id;
    const image = mediaUrl(item.imagePath);
    return (
      <li key={item.id} className={cx("flex items-center gap-3 px-3 py-2.5", pinned && "bg-accent-soft")}>
        <div className="relative shrink-0">
          {image ? (
            <img src={image} alt="" className="size-12 rounded-lg object-cover" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-lg bg-surface-3 text-muted">
              <ImageIcon className="size-5" />
            </span>
          )}
          {position ? <span className="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold ring-2 ring-surface">{position}</span> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CodeChip code={item.code} className="text-[11px]" />
            {pinned ? <Badge tone="live">Pinned</Badge> : openHere ? <Badge tone="held">Open</Badge> : item.unitsLeft === 0 ? <Badge tone="muted">Gone</Badge> : null}
          </div>
          <p className="truncate text-[14px] font-semibold">{item.title}</p>
          <p className="truncate text-[13px] text-fg-2">
            {priceLabel(item.pricePaise)}, {item.unitsLeft} of {item.quantity} left
            {item.waitlist ? <span className="text-gold">, {item.waitlist} in line</span> : null}
          </p>
        </div>
        {openHere ? (
          <div className="flex shrink-0 flex-col gap-1">
            {!pinned ? (
              <Button size="sm" variant="secondary" disabled={!isLive} loading={drop.isPending && drop.variables === item.id} onClick={() => drop.mutate(item.id)}>
                Pin
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" loading={close.isPending && close.variables === item.id} onClick={() => close.mutate(item.id)}>
              Close
            </Button>
          </div>
        ) : (
          <Button size="sm" disabled={!isLive || item.status === "open"} loading={drop.isPending && drop.variables === item.id} onClick={() => drop.mutate(item.id)}>
            <Sparkles className="size-3.5" /> Open
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-semibold">Items</p>
        <Link to="/studio/drops/$liveId" params={{ liveId: live.id }} className="text-[14px] font-semibold text-fg-2 hover:text-fg">
          Edit lineup
        </Link>
      </div>
      {!isLive ? (
        <p className="border-b border-line bg-gold-soft px-4 py-2 text-[14px] text-gold">{live.status === "draft" ? "Go live to open items." : "This drop has ended."}</p>
      ) : null}
      {data.items.length === 0 ? (
        <div className="p-4">
          <Empty
            title="No items yet"
            action={
              <Link to="/studio/catalog/new">
                <Button size="sm">Add an item</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="scrollbar-thin max-h-[72dvh] overflow-y-auto">
          {lineup.length ? (
            <>
              <p className="px-4 pb-1 pt-3 text-[13px] font-semibold text-fg-2">Lineup</p>
              <ul className="divide-y divide-line">{lineup.map((i, n) => row(i, n + 1))}</ul>
            </>
          ) : null}
          {others.length ? (
            <>
              {lineup.length ? <p className="border-t border-line px-4 pb-1 pt-3 text-[13px] font-semibold text-fg-2">More from your catalogue</p> : null}
              <ul className="divide-y divide-line">{others.map((i) => row(i))}</ul>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function rank(item: ItemWithCounts, pinnedId: string | null | undefined) {
  if (item.id === pinnedId) return 0;
  if (item.status === "open") return 1;
  if (item.unitsLeft > 0) return 2;
  return 3;
}

// --- Pinned item, next up and queues ------------------------------------------------------------

function Pinned({ console: data }: { console: LiveConsole }) {
  const snapshot = data.snapshot as unknown as Snapshot;
  const pinned = snapshot?.pinned;
  if (!pinned) {
    return (
      <div className="flex items-center gap-4 rounded-xl bg-surface p-4 shadow-surface">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-2">
          <Sparkles className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Nothing up for claims</p>
          <p className="text-[14px] text-fg-2">
            {data.live.status === "live" ? "Open an item. “mine” in chat claims whatever is pinned." : data.live.status === "draft" ? "Go live, then open your first item." : "This drop has ended."}
          </p>
        </div>
      </div>
    );
  }
  const image = mediaUrl(pinned.imagePath);
  return (
    <div className="space-y-3 rounded-xl bg-surface p-3 shadow-surface ring-1 ring-inset ring-accent/30 sm:p-4">
      <div className="flex items-center gap-4">
        {image ? <img src={image} alt="" className="size-20 shrink-0 rounded-xl object-cover sm:size-24" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge tone="live">Pinned</Badge>
            <CodeChip code={pinned.code} />
          </div>
          <p className="mt-1 truncate text-[17px] font-bold">{pinned.title}</p>
          <p className="tabular font-display text-[26px] font-extrabold leading-tight text-gold">{priceLabel(pinned.pricePaise)}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <Count label="Left" value={pinned.left} tone="text-fg" />
        <Count label="On hold" value={pinned.held} tone="text-good" />
        <Count label="Sold" value={pinned.paid} tone="text-info" />
        <Count label="In line" value={pinned.waitlist} tone="text-gold" />
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-1 py-2">
      <p className={cx("tabular font-display text-[24px] font-bold leading-none", tone)}>{value}</p>
      <p className="mt-1 truncate text-[12px] font-semibold text-fg-2">{label}</p>
    </div>
  );
}

/** The next lineup item, one tap away. */
function NextUp({ console: data, next, lineupCount }: { console: LiveConsole; next: ItemWithCounts | null; lineupCount: number }) {
  const { drop } = useItemActions(data.live.id);
  if (data.live.status === "ended") return null;
  if (!next) {
    if (!lineupCount || data.live.status !== "live") return null;
    return (
      <p className="rounded-xl bg-surface px-4 py-3 text-[14px] text-fg-2 shadow-surface">
        That's the whole lineup. Open anything else from Items, or end the drop when you're done.
      </p>
    );
  }
  const image = mediaUrl(next.imagePath);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 shadow-surface sm:flex-nowrap">
      {image ? <img src={image} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg-2">Next in the lineup</p>
        <p className="flex min-w-0 items-center gap-1.5">
          <CodeChip code={next.code} className="text-[11px]" />
          <span className="truncate text-[15px] font-semibold">{next.title}</span>
        </p>
        <p className="text-[13px] text-fg-2">
          {priceLabel(next.pricePaise)}, {next.unitsLeft} {next.unitsLeft === 1 ? "piece" : "pieces"}
        </p>
      </div>
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={data.live.status !== "live"}
        loading={drop.isPending && drop.variables === next.id}
        onClick={() => drop.mutate(next.id)}
      >
        <SkipForward className="size-4" /> Open next: {next.code}
      </Button>
    </div>
  );
}

function Queues({ console: data }: { console: LiveConsole }) {
  const groups = useMemo(() => {
    const byItem = new Map<string, QueueEntry[]>();
    for (const entry of data.queue) {
      const list = byItem.get(entry.itemId) ?? [];
      list.push(entry);
      byItem.set(entry.itemId, list);
    }
    const items = new Map(data.items.map((i) => [i.id, i]));
    return [...byItem.entries()]
      .map(([itemId, entries]) => ({ item: items.get(itemId), itemId, entries: entries.sort((a, b) => a.position - b.position) }))
      .sort((a, b) => {
        const pa = a.itemId === data.live.pinnedItemId ? 0 : a.item?.status === "open" ? 1 : 2;
        const pb = b.itemId === data.live.pinnedItemId ? 0 : b.item?.status === "open" ? 1 : 2;
        return pa - pb;
      });
  }, [data]);

  if (!groups.length) {
    return (
      <div className="rounded-xl bg-surface p-4 shadow-surface">
        <p className="font-semibold">Claim queue</p>
        <p className="mt-1 text-[14px] text-fg-2">Claims appear here the moment buyers type “mine” or tap Claim, in the order the server received them.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.itemId} className="overflow-hidden rounded-xl bg-surface shadow-surface">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <CodeChip code={g.entries[0]?.itemCode ?? g.item?.code ?? "?"} />
            <p className="min-w-0 flex-1 truncate font-semibold">{g.item?.title ?? "Item"}</p>
            <span className="shrink-0 text-[13px] text-fg-2">
              {g.entries.length} {g.entries.length === 1 ? "claim" : "claims"}
            </span>
          </div>
          <ol className="divide-y divide-line">
            {g.entries.map((e) => (
              <QueueRow key={e.claimId} entry={e} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  const left = useCountdown(entry.status === "held" ? entry.holdExpiresAt : null);
  const active = entry.status === "held" || entry.status === "waitlisted" || entry.status === "paid";
  const { shop } = useShop();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const block = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/shops/{shop_id}/blocked", { params: { path: { shop_id: shop.id } }, body: { buyerId: entry.buyerId } })),
    onSuccess: () => toast(`${entry.buyerName} can't claim in your drops any more.`, "info"),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <li className={cx("group flex items-center gap-3 px-3 py-2 sm:px-4", !active && "opacity-55")}>
      <span
        className={cx(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full font-display text-[14px] font-bold",
          entry.status === "held" && "bg-good text-white",
          entry.status === "paid" && "bg-info text-white",
          entry.status === "waitlisted" && "bg-gold text-canvas",
          !active && "bg-surface-3 text-fg-2",
        )}
      >
        {entry.position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{entry.buyerName}</p>
        <p className="truncate text-[13px] text-fg-2">
          {entry.source === "button" ? "Tapped Claim" : entry.said ? `“${entry.said}”` : "Claimed"}, {timeOfDay(entry.decidedAt)}
        </p>
      </div>
      {entry.status === "held" && entry.orderStatus !== "payment_reported" ? (
        <span className={cx("tabular font-mono text-[14px] font-bold", left < 60_000 ? "text-accent" : "text-fg-2")}>{clock(left)}</span>
      ) : null}
      {entry.orderStatus === "payment_reported" ? <OrderStatusBadge status="payment_reported" /> : <ClaimStatusBadge status={entry.status} />}
      {entry.status !== "paid" ? (
        confirming ? (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="danger" loading={block.isPending} onClick={() => block.mutate()}>
              Block
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-full p-1.5 text-muted transition hover:bg-surface-3 hover:text-accent focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={`Block ${entry.buyerName}`}
            title="Block this buyer"
          >
            <Ban className="size-4" />
          </button>
        )
      ) : null}
    </li>
  );
}

function PaymentChecks({ orders, liveId }: { orders: OrderView[]; liveId: string }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<OrderView | null>(null);
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: keys.console(liveId) }), queryClient.invalidateQueries({ queryKey: ["shop", shop.id, "orders"] })]);
  const confirm = useMutation({
    mutationFn: (orderId: string) => unwrap(api.POST("/api/v1/orders/{order_id}/confirm", { params: { path: { order_id: orderId } } })),
    onSuccess: async (o) => {
      await refresh();
      toast(`${o.buyerName}'s payment for ${o.itemCode} confirmed.`, "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const cancel = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      unwrap(api.POST("/api/v1/orders/{order_id}/cancel", { params: { path: { order_id: orderId } }, body: { reason } })),
    onSuccess: async () => {
      setCancelling(null);
      await refresh();
      toast("Order cancelled. The next buyer in line has been offered the item.", "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-surface ring-1 ring-inset ring-accent/40">
      <div className="flex items-center gap-2 bg-accent px-4 py-2.5 text-white">
        <BadgeCheck className="size-4" />
        <p className="font-semibold">Check {orders.length === 1 ? "this payment" : `${orders.length} payments`} in your UPI app</p>
      </div>
      <ul className="divide-y divide-line">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                {o.buyerName} <CodeChip code={o.itemCode} className="text-[11px]" /> {priceLabel(o.amountPaise)}
              </p>
              <p className="text-[14px] text-fg-2">
                UPI ref <span className="font-mono font-bold text-fg">{o.upiReference ?? "not given"}</span>
                {o.paymentReportedAt ? <span className="text-muted">, {timeAgo(o.paymentReportedAt)}</span> : null}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelling(o)}>
                Not received
              </Button>
              <Button variant="success" size="sm" loading={confirm.isPending && confirm.variables === o.id} onClick={() => confirm.mutate(o.id)}>
                Received
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {cancelling ? (
        <CancelOrderSheet
          open
          onClose={() => setCancelling(null)}
          busy={cancel.isPending}
          itemCode={cancelling.itemCode}
          buyerName={cancelling.buyerName}
          onConfirm={(reason) => cancel.mutate({ orderId: cancelling.id, reason })}
        />
      ) : null}
    </div>
  );
}

// --- Chat and co-host approvals -----------------------------------------------------------------

function ChatPanel({ console: data, channel, chatLive }: { console: LiveConsole; channel: ReturnType<typeof useOpenChannel>; chatLive: boolean }) {
  const { shop, staff } = useShop();
  const nameOf: NameOf = (userId) => {
    if (userId === shop.cohostUserId) return { name: "Co-host", role: "cohost" };
    if (userId.startsWith("t")) return { name: shop.displayName, role: "shop" };
    const fromMessage = channel.messages.find((m) => m.senderId === userId && m.senderName)?.senderName;
    return { name: fromMessage ?? "Buyer", role: "buyer" };
  };
  return (
    <div className="flex h-[60dvh] min-h-[360px] flex-col overflow-hidden rounded-xl bg-surface shadow-surface lg:h-[calc(100dvh-170px)]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="flex items-center gap-2 font-semibold">
          <MessageCircle className="size-4" /> Room chat
        </p>
        {channel.participants !== null ? <span className="text-[13px] text-fg-2">{channel.participants} watching</span> : null}
      </div>
      {!chatLive ? (
        <PreviewClaimsFeed slug={data.live.slug} myName="" nameOf={nameOf} />
      ) : data.live.status !== "live" ? (
        <div className="m-auto max-w-xs px-6 text-center text-[14px] text-fg-2">Chat opens when you go live.</div>
      ) : (
        <>
          <ChatFeed className="min-h-0 flex-1 bg-canvas/40" messages={channel.messages} nameOf={nameOf} myUserId={staff.nexconnUserId} empty="Buyers' messages and claim receipts show up here." />
          <ShopComposer channel={channel} senderName={shop.displayName} />
        </>
      )}
    </div>
  );
}

function ShopComposer({ channel, senderName }: { channel: ReturnType<typeof useOpenChannel>; senderName: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      await channel.send(value, { senderName });
      setText("");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSending(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-line bg-surface p-2.5">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message as ${senderName}`} maxLength={400} aria-label="Message the room" className="h-10" />
      <button
        type="submit"
        disabled={!text.trim() || sending}
        aria-label="Send"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:bg-white/15 disabled:text-white/45"
      >
        <ArrowUp className="size-5" strokeWidth={2.6} />
      </button>
    </form>
  );
}

const approvalKinds: Record<string, string> = {
  discount: "Asks for a discount",
  cod: "Asks for cash on delivery",
  extend_hold: "Asks for more time",
  other: "Needs your answer",
};

function Approvals({ approvals }: { approvals: Approval[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-surface ring-1 ring-inset ring-gold/40">
      <div className="flex items-center gap-2 bg-gold-soft px-4 py-2.5">
        <Bot className="size-4 text-gold" />
        <p className="font-semibold text-fg">The co-host needs you</p>
        <span className="ml-auto rounded-full bg-gold px-2 text-[12px] font-bold text-canvas">{approvals.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {approvals.map((a) => (
          <ApprovalRow key={a.id} approval={a} />
        ))}
      </ul>
    </div>
  );
}

function ApprovalRow({ approval }: { approval: Approval }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState(approval.proposedReply);
  const [editing, setEditing] = useState(false);
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      unwrap(
        api.POST("/api/v1/approvals/{approval_id}", {
          params: { path: { approval_id: approval.id } },
          body: { approve, reply: approve && reply.trim() !== approval.proposedReply ? reply.trim() : null },
        }),
      ),
    onSuccess: async (_, approve) => {
      await queryClient.invalidateQueries({ queryKey: keys.approvals(shop.id) });
      toast(approve ? "Reply posted in the room." : "Declined politely in the room.", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  return (
    <li className="space-y-2 px-4 py-3">
      <p className="text-[12px] font-bold text-gold">
        {approvalKinds[approval.kind] ?? approvalKinds.other}, {timeAgo(approval.createdAt)}
      </p>
      <p className="text-[15px]">
        <b>{approval.buyerName ?? "A buyer"}:</b> “{approval.question}”
      </p>
      {editing ? (
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} className="min-h-16" aria-label="Reply" />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="block w-full rounded-lg bg-surface-2 px-3 py-2 text-left text-[14px] text-fg-2 hover:bg-surface-3">
          <span className="text-[12px] font-bold text-muted">Suggested reply, tap to edit</span>
          <br />
          {reply}
        </button>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" loading={decide.isPending && decide.variables === false} onClick={() => decide.mutate(false)}>
          <X className="size-3.5" /> Decline
        </Button>
        <Button size="sm" variant="success" loading={decide.isPending && decide.variables === true} disabled={!reply.trim()} onClick={() => decide.mutate(true)}>
          Send reply
        </Button>
      </div>
    </li>
  );
}
