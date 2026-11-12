// Messenger-style inbox shared by buyers (/inbox) and shop teams (/studio/inbox). Each thread is a
// Nexconn group channel (`c…`) holding the buyer, the shop team and the shop's co-host; order cards
// arrive in it as messages with a structured payload. The side panel lists the orders between the
// two from the API, so the inbox stays useful even when chat cannot connect.
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronUp,
  Hourglass,
  IndianRupee,
  MessageCircle,
  Package,
  Radio,
  RefreshCw,
  Search,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { ShopLink } from "~/components/room/shop";
import { Avatar, Badge, Button, CodeChip, Sheet, Spinner, cx, errorMessage, useCountdown, useToast } from "~/components/ui";
import type { Conversation, OrderView } from "~/lib/api";
import { chatError, retryChat, roleOf, type ChatMessage, type ChatStatus, type Payload } from "~/lib/chat";
import { clock, mediaUrl, rupees, timeAgo } from "~/lib/format";
import { useChannelList, useChatStatus, useGroupChannel, type ChannelSummary } from "~/lib/useChat";

export type InboxSide = "buyer" | "seller";

export interface InboxProps {
  side: InboxSide;
  conversations: Conversation[] | undefined;
  loading: boolean;
  error?: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The signed-in person's Nexconn user ID and display name. */
  me: { userId: string; name: string };
  /** The server has a Nexconn App Key (false in preview mode). */
  chatLive: boolean;
  /** Query for the orders between the two people in a conversation. */
  ordersQuery: (c: Conversation) => UseQueryOptions<OrderView[], Error, OrderView[], readonly unknown[]>;
  /** Shown when there are no conversations. */
  empty: ReactNode;
  /** Shown above the list on wide screens, for example a note while a conversation opens. */
  banner?: ReactNode;
  /** Called when Nexconn reports a conversation the list does not know yet. */
  onUnknownChannel?: () => void;
  /** Fixed-position frame for wide screens (the page header height differs between apps). */
  frameClassName?: string;
}

const ORDER_STATUS: Record<string, { label: string; tone: "held" | "wait" | "info" | "muted" | "danger" }> = {
  awaiting_payment: { label: "Waiting for payment", tone: "wait" },
  payment_reported: { label: "Payment reported", tone: "info" },
  paid: { label: "Paid", tone: "held" },
  expired: { label: "Hold ran out", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

function otherParty(side: InboxSide, c: Conversation) {
  return side === "buyer"
    ? { name: c.shopName, avatar: mediaUrl(c.shopAvatarPath), sub: `@${c.shopHandle}` }
    : { name: c.buyerName, avatar: c.buyerAvatarUrl ?? null, sub: "Buyer" };
}

function preview(side: InboxSide, c: Conversation, summary: ChannelSummary | undefined, myUserId: string): string {
  const latest = summary?.latest;
  if (latest) {
    const p = latest.payload;
    const who = latest.senderId === myUserId ? "You: " : "";
    if (p?.t === "order") return `${who}Order ${p.itemCode}, ${ORDER_STATUS[p.status]?.label.toLowerCase() ?? p.status}`;
    if (p?.t === "payment_reported") return "Payment reported";
    if (p?.t === "live") return "Live now";
    return `${who}${latest.text}`;
  }
  if (c.openOrders > 0) return c.openOrders === 1 ? "1 order waiting on someone" : `${c.openOrders} orders waiting on someone`;
  return side === "buyer" ? "Say hello to the shop" : "No messages yet";
}

export function Inbox(props: InboxProps) {
  const { side, conversations, selectedId, onSelect, chatLive, me, onUnknownChannel } = props;
  const list = useChannelList(chatLive);
  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  // A conversation Nexconn knows but our list does not (a new order, a new buyer): refresh.
  useEffect(() => {
    if (!conversations || !onUnknownChannel) return;
    const known = new Set(conversations.map((c) => c.nexconnGroupId));
    if (Object.keys(list.summaries).some((id) => !known.has(id))) onUnknownChannel();
  }, [conversations, list.summaries, onUnknownChannel]);

  const sorted = useMemo(() => {
    const at = (c: Conversation) => Math.max(new Date(c.lastActivityAt).getTime(), list.summaries[c.nexconnGroupId]?.latest?.sentTime ?? 0);
    return (conversations ?? []).slice().sort((a, b) => at(b) - at(a));
  }, [conversations, list.summaries]);

  return (
    <div className={cx("md:flex md:overflow-hidden md:border-t md:border-line md:bg-canvas", props.frameClassName)}>
      <ConversationList
        {...props}
        conversations={sorted}
        summaries={list.summaries}
        className={cx("md:flex md:w-[320px] md:shrink-0 md:border-r md:border-line lg:w-[360px]", selected ? "hidden" : "flex")}
      />
      {selected ? (
        <Thread
          key={selected.id}
          side={side}
          conversation={selected}
          me={me}
          chatLive={chatLive}
          ordersQuery={props.ordersQuery}
          onBack={() => onSelect(null)}
        />
      ) : (
        <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center md:flex">
          <MessageCircle className="size-10 text-muted" aria-hidden />
          <p className="text-[17px] font-semibold">{conversations?.length ? "Pick a conversation" : "No conversations yet"}</p>
          <p className="max-w-sm text-[14px] text-muted">
            {side === "buyer"
              ? "Your chats with shops live here, with every order you win right beside the messages."
              : "Buyers who message your shop, and every buyer who wins a claim, show up here with their orders."}
          </p>
        </div>
      )}
    </div>
  );
}

function ConversationList({
  side,
  conversations,
  summaries,
  loading,
  error,
  selectedId,
  onSelect,
  empty,
  banner,
  me,
  chatLive,
  className,
}: InboxProps & { conversations: Conversation[]; summaries: Record<string, ChannelSummary>; className?: string }) {
  const [query, setQuery] = useState("");
  const shown = query.trim()
    ? conversations.filter((c) => otherParty(side, c).name.toLowerCase().includes(query.trim().toLowerCase()))
    : conversations;
  return (
    <section className={cx("min-h-0 flex-col md:bg-surface", className)} aria-label="Conversations">
      <div className="space-y-3 px-3 pb-2 pt-3 md:px-4 md:pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-[24px] font-bold">Chats</h1>
          <ConnectionBadge chatLive={chatLive} />
        </div>
        <label className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-3 text-fg-2">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={side === "buyer" ? "Search shops" : "Search buyers"}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
            aria-label={side === "buyer" ? "Search shops" : "Search buyers"}
          />
        </label>
        {banner}
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 md:px-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : error ? (
          <p className="px-3 py-6 text-center text-[14px] text-muted">{error}</p>
        ) : !conversations.length ? (
          <div className="px-3 py-6">{empty}</div>
        ) : !shown.length ? (
          <p className="px-3 py-6 text-center text-[14px] text-muted">No chats match “{query.trim()}”.</p>
        ) : (
          <ul>
            {shown.map((c) => {
              const party = otherParty(side, c);
              const summary = summaries[c.nexconnGroupId];
              const unread = summary?.unreadCount ?? 0;
              const active = c.id === selectedId;
              const when = summary?.latest?.sentTime ?? new Date(c.lastActivityAt).getTime();
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onSelect(c.id)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition",
                      active ? "bg-accent-soft" : "hover:bg-white/5",
                    )}
                    aria-current={active ? "true" : undefined}
                  >
                    <span className="relative shrink-0">
                      <Avatar name={party.name} src={party.avatar} size={52} />
                      {c.openOrders > 0 ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-gold text-canvas ring-2 ring-surface"
                          title="Open order"
                        >
                          <IndianRupee className="size-3" aria-hidden />
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cx("min-w-0 flex-1 truncate text-[15px]", unread ? "font-bold text-fg" : "font-medium")}>{party.name}</span>
                        <span className="shrink-0 text-[12px] text-muted">{timeAgo(when)}</span>
                      </span>
                      <span className={cx("block truncate text-[13px]", unread ? "font-semibold text-fg" : "text-muted")}>
                        {preview(side, c, summary, me.userId)}
                      </span>
                    </span>
                    {unread ? (
                      <span className="tabular flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">
                        <span className="sr-only">Unread messages: </span>
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ConnectionBadge({ chatLive }: { chatLive: boolean }) {
  const status = useChannelStatus(chatLive);
  if (status === "connected")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-good">
        <span className="size-2 rounded-full bg-good" aria-hidden /> Live
      </span>
    );
  if (status === "connecting") return <span className="text-[12px] font-semibold text-muted">Connecting</span>;
  if (status === "preview")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <WifiOff className="size-3.5" aria-hidden /> Chat preview
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted">
      <WifiOff className="size-3.5" aria-hidden /> Offline
    </span>
  );
}

function useChannelStatus(chatLive: boolean): ChatStatus | "preview" {
  const status = useChatStatus();
  return chatLive ? status : "preview";
}

// --- Thread ---------------------------------------------------------------------------------------

function Thread({
  side,
  conversation,
  me,
  chatLive,
  ordersQuery,
  onBack,
}: {
  side: InboxSide;
  conversation: Conversation;
  me: { userId: string; name: string };
  chatLive: boolean;
  ordersQuery: InboxProps["ordersQuery"];
  onBack: () => void;
}) {
  const party = otherParty(side, conversation);
  const ready = chatLive && conversation.provisioned;
  const chat = useGroupChannel(ready ? conversation.nexconnGroupId : null, ready);
  const orders = useQuery(ordersQuery(conversation));
  const [ordersOpen, setOrdersOpen] = useState(false);
  const ordersById = useMemo(() => new Map((orders.data ?? []).map((o) => [o.id, o])), [orders.data]);
  const connected = chat.status === "connected";

  const nameOf = (userId: string, senderName?: string): { name: string; role: "me" | "shop" | "cohost" | "buyer" } => {
    if (userId === me.userId) return { name: "You", role: "me" };
    const role = roleOf(userId);
    if (role === "cohost") return { name: `${conversation.shopName} co-host`, role: "cohost" };
    if (role === "staff") return { name: side === "buyer" ? conversation.shopName : senderName || "Shop team", role: "shop" };
    return { name: side === "seller" ? conversation.buyerName : senderName || "Buyer", role: "buyer" };
  };

  const ordersPanel = <OrdersPanel side={side} conversation={conversation} orders={orders.data} loading={orders.isPending} />;

  let body: ReactNode;
  if (!chatLive) {
    body = (
      <Notice icon={<WifiOff className="size-5" />} title="Messages appear here once chat is connected">
        {side === "buyer"
          ? `Your orders with ${conversation.shopName} are ready, and the shop sees them too.`
          : `Your orders with ${conversation.buyerName} are ready. Confirm payments from the order page.`}
        <div className="mt-4 text-left xl:hidden">{ordersPanel}</div>
      </Notice>
    );
  } else if (!conversation.provisioned) {
    body = (
      <Notice icon={<Spinner />} title="Setting up this conversation">
        It takes a moment the first time. Your orders are already here.
        <div className="mt-4 text-left xl:hidden">{ordersPanel}</div>
      </Notice>
    );
  } else if (chat.status === "error") {
    body = (
      <Notice icon={<WifiOff className="size-5" />} title="Chat can't connect right now">
        {chatError() ?? "Chat is busy."} Your orders still work.
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={() => void retryChat().catch(() => undefined)}>
            <RefreshCw className="size-4" aria-hidden /> Try again
          </Button>
        </div>
        <div className="mt-4 text-left xl:hidden">{ordersPanel}</div>
      </Notice>
    );
  } else {
    body = (
      <Messages
        messages={chat.messages}
        loading={chat.loading || !connected}
        hasOlder={chat.hasOlder}
        loadingOlder={chat.loadingOlder}
        loadOlder={chat.loadOlder}
        nameOf={nameOf}
        side={side}
        ordersById={ordersById}
        greeting={
          side === "buyer"
            ? `Ask ${conversation.shopName} about sizes, shipping or an order. The shop's co-host answers common questions right away.`
            : `This is your private chat with ${conversation.buyerName}. Order updates for this buyer land here too.`
        }
      />
    );
  }

  return (
    <section
      className="fixed inset-0 z-50 flex min-w-0 flex-col bg-canvas md:static md:z-auto md:flex-1"
      aria-label={`Conversation with ${party.name}`}
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)] md:px-4">
        <button
          onClick={onBack}
          className="flex size-10 items-center justify-center rounded-full text-fg-2 hover:bg-white/10 md:hidden"
          aria-label="Back to chats"
        >
          <ArrowLeft className="size-5" />
        </button>
        <Avatar name={party.name} src={party.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold">{party.name}</p>
          <p className="truncate text-[12px] text-muted">
            {side === "buyer" ? (
              <ShopLink handle={conversation.shopHandle} className="hover:underline">
                {party.sub}
              </ShopLink>
            ) : (
              "Buyer"
            )}
          </p>
        </div>
        <Button size="sm" variant="secondary" className="xl:hidden" onClick={() => setOrdersOpen(true)}>
          <Package className="size-4" aria-hidden /> Orders{orders.data?.length ? ` (${orders.data.length})` : ""}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">{body}</div>
          {chatLive && conversation.provisioned && chat.status !== "error" ? (
            <ThreadComposer
              enabled={connected}
              onSend={(text) => chat.send(text, me.name)}
              placeholder={connected ? `Message ${party.name}` : "Connecting to chat"}
            />
          ) : null}
        </div>
        <aside className="scrollbar-thin hidden w-[340px] shrink-0 overflow-y-auto border-l border-line bg-surface p-4 xl:block" aria-label="Orders">
          {ordersPanel}
        </aside>
      </div>
      <Sheet open={ordersOpen} onClose={() => setOrdersOpen(false)} title={`Orders with ${party.name}`}>
        {ordersPanel}
      </Sheet>
    </section>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-8">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-fg-2" aria-hidden>
          {icon}
        </span>
        <p className="mt-3 text-[17px] font-semibold">{title}</p>
        <div className="mt-1 w-full text-[14px] text-muted">{children}</div>
      </div>
    </div>
  );
}

function dayLabel(ms: number) {
  const d = new Date(ms);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
}

function timeLabel(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function Messages({
  messages,
  loading,
  hasOlder,
  loadingOlder,
  loadOlder,
  nameOf,
  side,
  ordersById,
  greeting,
}: {
  messages: ChatMessage[];
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  nameOf: (userId: string, senderName?: string) => { name: string; role: "me" | "shop" | "cohost" | "buyer" };
  side: InboxSide;
  ordersById: Map<string, OrderView>;
  greeting: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId, loading]);

  if (loading && !messages.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="scrollbar-thin h-full overflow-y-auto px-3 py-4 md:px-6"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {hasOlder ? (
        <div className="mb-3 flex justify-center">
          <Button size="sm" variant="ghost" loading={loadingOlder} onClick={() => void loadOlder()}>
            <ChevronUp className="size-4" aria-hidden /> Earlier messages
          </Button>
        </div>
      ) : (
        <p className="mx-auto mb-4 max-w-sm text-center text-[13px] text-muted">{greeting}</p>
      )}
      <ol className="space-y-1">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const who = nameOf(m.senderId, m.senderName);
          // Shop-team replies sit on the right for the shop, like a Page inbox.
          const right = who.role === "me" || (side === "seller" && who.role === "shop");
          const newDay = !prev || dayLabel(prev.sentTime) !== dayLabel(m.sentTime);
          const firstOfRun = newDay || !prev || prev.senderId !== m.senderId || m.sentTime - prev.sentTime > 5 * 60_000;
          const lastOfRun = !next || next.senderId !== m.senderId || next.sentTime - m.sentTime > 5 * 60_000;
          return (
            <li key={m.id}>
              {newDay ? (
                <p className="my-3 text-center text-[12px] font-semibold text-muted">
                  {dayLabel(m.sentTime)}, {timeLabel(m.sentTime)}
                </p>
              ) : null}
              <MessageRow message={m} who={who} right={right} firstOfRun={firstOfRun} lastOfRun={lastOfRun} side={side} ordersById={ordersById} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessageRow({
  message,
  who,
  right,
  firstOfRun,
  lastOfRun,
  side,
  ordersById,
}: {
  message: ChatMessage;
  who: { name: string; role: "me" | "shop" | "cohost" | "buyer" };
  right: boolean;
  firstOfRun: boolean;
  lastOfRun: boolean;
  side: InboxSide;
  ordersById: Map<string, OrderView>;
}) {
  const p = message.payload;
  if (p?.t === "order") return <OrderMessage payload={p} current={ordersById.get(p.orderId)} side={side} sentTime={message.sentTime} />;
  if (p?.t === "payment_reported") {
    return (
      <SystemCard icon={<IndianRupee className="size-4" />} tone="info">
        <span className="min-w-0 flex-1">{message.text || "Payment reported."}</span>
        <Link to="/o/$orderId" params={{ orderId: p.orderId }} className="shrink-0 font-semibold text-info hover:underline">
          {side === "seller" ? "Check payment" : "View order"}
        </Link>
      </SystemCard>
    );
  }
  if (p?.t === "live") {
    return (
      <SystemCard icon={<Radio className="size-4" />} tone="live">
        <span className="min-w-0 flex-1">{message.text.split(":")[0] || "The shop is live now"}</span>
        <Link to="/l/$slug" params={{ slug: p.slug }} className="shrink-0 font-semibold text-accent hover:underline">
          Join the drop
        </Link>
      </SystemCard>
    );
  }
  const cohost = who.role === "cohost" || p?.t === "cohost";
  return (
    <div className={cx("flex flex-col", right ? "items-end" : "items-start", firstOfRun && "mt-2")}>
      {firstOfRun && who.role !== "me" ? (
        <p className={cx("mb-0.5 flex items-center gap-1 px-3 text-[12px] font-semibold", cohost ? "text-gold" : "text-muted")}>
          {cohost ? <Bot className="size-3.5" aria-hidden /> : null}
          {who.name}
        </p>
      ) : null}
      <div
        className={cx(
          "max-w-[min(80%,520px)] whitespace-pre-line break-words px-3 py-2 text-[15px] leading-snug",
          right ? "bg-accent text-white" : cohost ? "bg-gold-soft text-fg ring-1 ring-inset ring-gold/25" : "bg-surface-2 text-fg",
          right ? "rounded-[18px] rounded-r-md" : "rounded-[18px] rounded-l-md",
          right ? firstOfRun && "rounded-tr-[18px]" : firstOfRun && "rounded-tl-[18px]",
          right ? lastOfRun && "rounded-br-[18px]" : lastOfRun && "rounded-bl-[18px]",
        )}
        title={timeLabel(message.sentTime)}
      >
        {message.text}
      </div>
    </div>
  );
}

function SystemCard({ icon, tone, children }: { icon: ReactNode; tone: "info" | "live"; children: ReactNode }) {
  return (
    <div className="my-2 flex justify-center">
      <div
        className={cx(
          "flex w-full max-w-md items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px]",
          tone === "info" ? "bg-info-soft text-fg" : "bg-accent-soft text-fg",
        )}
      >
        <span className={tone === "info" ? "text-info" : "text-accent"} aria-hidden>
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}

/** The checkout card the co-host posts: item, amount, status and the way to pay or review it. */
function OrderMessage({
  payload,
  current,
  side,
  sentTime,
}: {
  payload: Extract<Payload, { t: "order" }>;
  current: OrderView | undefined;
  side: InboxSide;
  sentTime: number;
}) {
  // The API knows the order's latest state; the card was written when it was sent.
  const status = current?.status ?? payload.status;
  const holdExpiresAt = current?.holdExpiresAt ?? payload.holdExpiresAt;
  const left = useCountdown(status === "awaiting_payment" ? holdExpiresAt : null);
  const meta = ORDER_STATUS[status] ?? { label: status, tone: "muted" as const };
  const image = mediaUrl(payload.imageUrl ?? current?.itemImagePath);
  const free = payload.amountPaise === 0;
  const action =
    status === "awaiting_payment"
      ? side === "buyer"
        ? "Pay now"
        : "View order"
      : status === "payment_reported" && side === "seller"
        ? "Check payment"
        : "View order";
  return (
    <div className="my-3 flex justify-center">
      <article className="w-full max-w-md overflow-hidden rounded-xl bg-surface shadow-surface">
        {payload.promoted && status === "awaiting_payment" ? (
          <p className="bg-good-soft px-3 py-1.5 text-[13px] font-semibold text-good">
            It moved to {side === "buyer" ? "you" : "this buyer"}: the person ahead didn't pay in time.
          </p>
        ) : null}
        <div className="flex gap-3 p-3">
          <span className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-surface-3">
            {image ? <img src={image} alt="" className="size-full object-cover" loading="lazy" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
              <CodeChip code={payload.itemCode} className="text-[11px]" />
              <span className="truncate">{payload.itemTitle}</span>
            </p>
            <p className="tabular mt-0.5 text-[17px] font-bold">{free ? "Free" : rupees(payload.amountPaise)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {status === "awaiting_payment" && left > 0 ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-fg-2">
                  <Hourglass className="size-3.5 text-gold" aria-hidden />
                  <span className="tabular font-mono">{clock(left)}</span> left
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-[12px] text-muted">
            Order {payload.reference}, {timeLabel(sentTime)}
          </span>
          <Link
            to="/o/$orderId"
            params={{ orderId: payload.orderId }}
            className={cx(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-[13px] font-bold",
              action === "Pay now" || action === "Check payment"
                ? "bg-good text-canvas hover:brightness-110"
                : "bg-white/10 text-fg hover:bg-white/15",
            )}
          >
            {action} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </article>
    </div>
  );
}

function ThreadComposer({ enabled, onSend, placeholder }: { enabled: boolean; onSend: (text: string) => Promise<void>; placeholder: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || !enabled || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setText("");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <form
      onSubmit={submit}
      className="flex shrink-0 items-end gap-2 border-t border-line bg-surface px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 md:pb-3"
    >
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={1000}
        placeholder={placeholder}
        disabled={!enabled}
        aria-label="Message"
        className="max-h-[132px] min-h-10 min-w-0 flex-1 resize-none rounded-[20px] bg-surface-2 px-4 py-2 text-[15px] leading-6 text-fg outline-none placeholder:text-muted focus:bg-surface-3 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={!enabled || !text.trim() || sending}
        aria-label="Send"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:bg-white/15 disabled:text-white/45"
      >
        <ArrowUp className="size-5" strokeWidth={2.6} />
      </button>
    </form>
  );
}

// --- Orders panel ----------------------------------------------------------------------------------

function OrdersPanel({
  side,
  conversation,
  orders,
  loading,
}: {
  side: InboxSide;
  conversation: Conversation;
  orders: OrderView[] | undefined;
  loading: boolean;
}) {
  const party = side === "buyer" ? conversation.shopName : conversation.buyerName;
  return (
    <div>
      <h2 className="text-[15px] font-bold text-fg">Orders with {party}</h2>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : !orders?.length ? (
        <p className="mt-2 text-[14px] text-muted">
          {side === "buyer"
            ? `Nothing yet. When you win a claim in ${conversation.shopName}'s drops, the order shows up here.`
            : `Nothing yet. When ${conversation.buyerName} wins a claim, the order shows up here.`}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} side={side} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderRow({ order, side }: { order: OrderView; side: InboxSide }) {
  const meta = ORDER_STATUS[order.status] ?? { label: order.status, tone: "muted" as const };
  const left = useCountdown(order.status === "awaiting_payment" ? order.holdExpiresAt : null);
  const image = mediaUrl(order.itemImagePath);
  return (
    <li>
      <Link
        to="/o/$orderId"
        params={{ orderId: order.id }}
        className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5 text-left transition hover:bg-surface-3"
      >
        <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-surface-3">
          {image ? <img src={image} alt="" className="size-full object-cover" loading="lazy" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[14px] font-semibold">
            <CodeChip code={order.itemCode} className="text-[11px]" />
            <span className="truncate">{order.itemTitle}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular text-[14px] font-bold">{order.amountPaise === 0 ? "Free" : rupees(order.amountPaise)}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {left > 0 ? <span className="tabular font-mono text-[12px] text-gold">{clock(left)}</span> : null}
          </span>
          <span className="mt-0.5 block text-[12px] text-muted">
            {side === "seller" && order.status === "payment_reported" && order.upiReference ? `UPI ref ${order.upiReference}, ` : ""}
            {timeAgo(order.createdAt)}
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
