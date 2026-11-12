import { ArrowDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, keys, unwrap } from "~/lib/api";
import type { ChatMessage } from "~/lib/chat";
import { mediaUrl, rupees } from "~/lib/format";

import { CodeChip, cx } from "./ui";

/** Display name and role for a chat user ID, from what the page knows. */
export type NameOf = (userId: string) => { name: string; role: "buyer" | "shop" | "cohost" };

/** `panel` is the Twitch-style column; `overlay` floats over the stream on phones. */
export type FeedVariant = "panel" | "overlay";

/**
 * YouTube-style live chat: avatar, grey name, white message. Claim receipts are ordinary chat lines whose
 * decision rides in a small chip after the name, so the whole room sees every decision.
 */
export function ChatFeed({
  messages,
  nameOf,
  myUserId,
  empty,
  className,
  variant = "panel",
}: {
  messages: ChatMessage[];
  nameOf: NameOf;
  myUserId: string | null;
  empty?: string;
  className?: string;
  variant?: FeedVariant;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const overlay = variant === "overlay";

  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Follow the newest message (the list is capped, so its length alone stops changing).
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (atBottom) toBottom();
    else if (lastId) setUnseen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  return (
    <div className={cx("relative min-h-0", className)}>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          setAtBottom(bottom);
          if (bottom) setUnseen(0);
        }}
        className={cx(
          "h-full overflow-y-auto overscroll-contain",
          overlay ? "no-scrollbar flex flex-col py-1 [mask-image:linear-gradient(to_bottom,transparent,black_28%)]" : "scrollbar-thin py-2",
        )}
        aria-live="polite"
        aria-relevant="additions"
        role="log"
        aria-label="Live chat"
      >
        {overlay ? <div className="flex-1" aria-hidden /> : null}
        {messages.length === 0 ? (
          overlay ? null : (
            <p className="mx-4 mt-3 rounded-lg bg-white/[0.08] px-3 py-2.5 text-[13px] leading-5 text-white/90">
              Welcome to live chat! {empty ?? "Every claim here is put in order by the server."}
            </p>
          )
        ) : (
          messages.map((m) => <Line key={m.id} message={m} nameOf={nameOf} mine={m.mine || m.senderId === myUserId} overlay={overlay} />)
        )}
      </div>
      {!atBottom && unseen > 0 ? (
        <button
          onClick={() => {
            toBottom(true);
            setUnseen(0);
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1.5 text-[13px] font-semibold text-fg shadow-lift ring-1 ring-line-strong"
        >
          <ArrowDown className="size-3.5" /> {unseen} new
        </button>
      ) : null}
    </div>
  );
}

/** YouTube's chat avatar colours: muted, so names and messages stay the loudest thing. */
const AVATAR_COLOURS = ["#5c6bc0", "#8d6e63", "#689f38", "#1e88e5", "#546e7a", "#ab47bc", "#00897b", "#f4511e", "#c2185b", "#7e57c2"];

function hashOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export function ChatAvatar({ name, size = 24 }: { name: string; size?: number }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: AVATAR_COLOURS[hashOf(name) % AVATAR_COLOURS.length] }}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full text-[12px] font-medium text-white"
    >
      {letter}
    </span>
  );
}

/** The small pill YouTube puts after a name (like a top-fan rank), here carrying the server's decision. */
export type ChipTone = "hold" | "wait" | "won" | "out";
export function DecisionChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "mr-2 inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 align-top text-[12px] font-medium leading-5",
        tone === "hold" && "bg-[#1b5e20] text-white",
        tone === "won" && "bg-[#2e7d32] text-white",
        tone === "wait" && "bg-[#4a3c0e] text-[#ffd76a]",
        tone === "out" && "bg-white/10 text-[#aaaaaa]",
      )}
    >
      {children}
    </span>
  );
}

function Wrench() {
  return (
    <svg viewBox="0 0 16 16" className="ml-1 inline size-3.5 -translate-y-px fill-current" aria-hidden>
      <path d="M13.9 4.6 11.7 6.8 9.2 4.3l2.2-2.2a3.6 3.6 0 0 0-4.6 4.6L2.3 11.2a1.3 1.3 0 0 0 1.9 1.9l4.5-4.5a3.6 3.6 0 0 0 4.6-4.6Z" />
    </svg>
  );
}

function YouTubeMark() {
  return (
    <svg viewBox="0 0 20 14" className="mr-1.5 inline h-3 w-[17px] -translate-y-px" aria-label="from YouTube">
      <rect width="20" height="14" rx="3.5" fill="#ff0033" />
      <path d="M8 4v6l5-3z" fill="#fff" />
    </svg>
  );
}

/** One YouTube-style chat row: avatar, grey name (plus chips), then the message in white. */
function Row({
  name,
  nameNode,
  chip,
  overlay,
  highlight,
  pending,
  children,
}: {
  name: string;
  nameNode?: ReactNode;
  chip?: ReactNode;
  overlay: boolean;
  highlight?: boolean;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex animate-rise items-start text-[14px] leading-5",
        overlay ? "gap-2.5 px-2 py-[3px] [text-shadow:0_1px_2px_rgb(0_0_0/0.85)]" : "gap-4 px-4 py-1 hover:bg-white/[0.04]",
        highlight && (overlay ? "rounded-md bg-white/15" : "bg-white/[0.07]"),
        pending && "opacity-50",
      )}
    >
      <ChatAvatar name={name} />
      <p className="min-w-0 flex-1 break-words">
        <span className={cx("mr-2 font-medium", overlay ? "text-white/75" : "text-[#aaaaaa]")}>{nameNode ?? name}</span>
        {chip}
        <span className="text-white">{children}</span>
      </p>
    </div>
  );
}

function Line({ message, nameOf, mine, overlay }: { message: ChatMessage; nameOf: NameOf; mine: boolean; overlay: boolean }) {
  const p = message.payload;
  const sender = nameOf(message.senderId);

  if (p?.t === "receipt") {
    const paid = p.status === "paid";
    const held = p.status === "held" || paid;
    const waiting = p.status === "waitlisted";
    const name = mine ? "You" : p.buyerName;
    const code = p.itemCode ? <CodeChip code={p.itemCode} className="mx-0.5 align-top text-[11px]" /> : null;
    const said = p.said && p.said !== "Claim" ? p.said : "Claim";
    const chip =
      p.outcome === "already" ? (
        <DecisionChip tone="wait">⏳ #{p.position ?? ""}</DecisionChip>
      ) : paid ? (
        <DecisionChip tone="won">🎉 Won</DecisionChip>
      ) : held ? (
        <DecisionChip tone="hold">✅ #{p.position}</DecisionChip>
      ) : waiting ? (
        <DecisionChip tone="wait">⏳ #{p.position}</DecisionChip>
      ) : (
        <DecisionChip tone="out">⌛ Missed</DecisionChip>
      );
    const after =
      p.outcome === "already"
        ? "already waiting for"
        : paid
          ? "won"
          : held
            ? "got"
            : waiting
              ? "waiting for"
              : p.outcome === "expired"
                ? "didn't pay in time for"
                : p.outcome === "cancelled"
                  ? "order cancelled for"
                  : "let go of";
    const closed = !held && !waiting && p.outcome !== "already";
    return (
      <Row
        name={name}
        overlay={overlay}
        highlight={mine}
        nameNode={
          <>
            {p.source === "youtube" ? <YouTubeMark /> : null}
            {name}
          </>
        }
        chip={chip}
      >
        {closed ? null : <span className="mr-1.5">{said}</span>}
        <span className={overlay ? "text-white/70" : "text-[#aaaaaa]"}>{after}</span> {code}
        {paid ? " 🎉" : null}
      </Row>
    );
  }

  // My own Claim tap, before the server's decision comes back: shown greyed, like an unsent YouTube message.
  if (p?.t === "claim") {
    return (
      <Row name={mine ? "You" : sender.name} overlay={overlay} pending>
        {p.code ? p.code : "mine"}
      </Row>
    );
  }

  // A new piece goes up: styled like a Super Chat card so nobody misses it.
  if (p?.t === "drop") {
    const image = mediaUrl(p.imageUrl);
    const free = p.pricePaise === 0;
    return (
      <div className={cx("my-2 animate-pop overflow-hidden rounded-lg shadow-lift", overlay ? "mx-1 max-w-[92%] self-start" : "mx-4")}>
        <div className="flex items-center gap-3 bg-[#c2185b] px-3 py-2">
          {image ? <img src={image} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <ChatAvatar name={p.title} size={40} />}
          <div className="min-w-0 flex-1 text-white">
            <p className="truncate text-[13px] text-white/80">Up now {p.code}</p>
            <p className="truncate text-[14px] font-medium">{p.title}</p>
          </div>
          <p className="shrink-0 text-[15px] font-bold text-white">{free ? "Free" : rupees(p.pricePaise)}</p>
        </div>
        <p className="bg-[#e91e63] px-3 py-2 text-[14px] leading-5 text-white">
          {p.quantity === 1 ? "1 piece." : `${p.quantity} pieces.`} Type <b>mine</b> to claim 🙋
        </p>
      </div>
    );
  }

  const role = p?.t === "cohost" ? "cohost" : sender.role;
  const name = role === "cohost" ? "Co-host" : mine ? sender.name || "You" : sender.name;
  const nameNode =
    role === "shop" ? (
      <span className="rounded-full bg-[#f1f1f1] px-1.5 py-px text-[#0f0f0f] [text-shadow:none]">{name}</span>
    ) : role === "cohost" ? (
      <span className="text-[#5e84f1]">
        {name}
        <Wrench />
      </span>
    ) : undefined;
  return (
    <Row name={name} nameNode={nameNode} overlay={overlay} highlight={mine}>
      {message.text}
    </Row>
  );
}

/**
 * Without a Nexconn connection the chat column still shows the room's real decisions, built from
 * the public fairness log, so buyers see every claim as it happens.
 */
export function PreviewClaimsFeed({
  slug,
  myName,
  nameOf,
  variant = "panel",
  note = "Live claims from the room's fairness log. Every decision shows here as it happens.",
  pollMs = 2_500,
  mineKeys,
}: {
  slug: string;
  /** Fallback for spotting your own claims when `mineKeys` is not given. */
  myName: string;
  nameOf: NameOf;
  variant?: FeedVariant;
  /** Banner above the feed; pass null to hide it. */
  note?: string | null;
  pollMs?: number;
  /** `${itemCode}-${position}` of the viewer's own claims; more reliable than matching names. */
  mineKeys?: Set<string>;
}) {
  const log = useQuery({
    queryKey: keys.fairness(slug),
    queryFn: () => unwrap(api.GET("/api/v1/rooms/{slug}/fairness", { params: { path: { slug }, query: {} } })),
    refetchInterval: pollMs,
  });
  const messages = useMemo<ChatMessage[]>(() => {
    const entries = (log.data?.queue ?? []).slice().sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
    return entries.map((e) => ({
      id: `${e.itemCode}-${e.position}`,
      channelId: slug,
      senderId: "preview",
      sentTime: new Date(e.decidedAt).getTime(),
      text: "",
      mine: mineKeys ? mineKeys.has(`${e.itemCode}-${e.position}`) : Boolean(myName) && e.buyerName === myName,
      payload: {
        t: "receipt",
        source: e.source === "youtube" ? "youtube" : "button",
        said: "Claim",
        buyerName: e.buyerName,
        outcome: e.status,
        itemCode: e.itemCode,
        position: e.position,
        status: e.status === "expired" || e.status === "released" || e.status === "cancelled" ? "closed" : e.status,
      },
    }));
  }, [log.data, myName, slug, mineKeys]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {note ? <p className="shrink-0 border-b border-line bg-surface-2 px-3 py-1.5 text-center text-[12px] leading-snug text-fg-2">{note}</p> : null}
      <ChatFeed className="flex-1" messages={messages} nameOf={nameOf} myUserId={null} empty="No claims yet. Be the first!" variant={variant} />
    </div>
  );
}
