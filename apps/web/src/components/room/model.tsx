// Everything the drop room knows, in one place: the API view, the live Nexconn state (metadata,
// messages, head count) when chat is connected, the server clock, and the claim flow. Screens in
// this folder only render what this hook returns.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { NameOf } from "~/components/chat-feed";
import { useSignIn } from "~/components/sign-in";
import { errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type ClaimResult, type PublicItem, type QueueEntry, type RoomView, type SessionInfo } from "~/lib/api";
import { chatError, resetChat, roleOf, type ChatMessage, type ChatStatus } from "~/lib/chat";
import { buyerOf, useSession, type ItemState, type Snapshot } from "~/lib/session";
import { readMeta, useChatConnection, useOpenChannel, useServerNow, type OpenChannelState } from "~/lib/useChat";

export type Buyer = NonNullable<ReturnType<typeof buyerOf>>;

/** A room item with its photos and words, merged from the live state and the lineup. */
export interface RoomItem extends ItemState {
  photos: string[];
  description: string | null;
  free: boolean;
}

/** A claim that still matters to the buyer: holding, waiting or bought. */
export const ACTIVE = ["held", "waitlisted", "paid"] as const;
export function isActive(entry: QueueEntry) {
  return (ACTIVE as readonly string[]).includes(entry.status);
}

/** How the room reaches the server right now. */
export type Transport = "live" | "api";

export interface ClaimController {
  /** Item code whose claim is in flight. */
  pendingCode: string | null;
  claim: (code: string) => Promise<void>;
  /** The latest decision for this visitor, for the coach and the alerts prompt. */
  last: { code: string; outcome: ClaimResult["outcome"]; position: number | null; at: number } | null;
}

export interface RoomModel {
  slug: string;
  data: RoomView;
  snapshot: Snapshot;
  status: Snapshot["status"];
  chat: OpenChannelState;
  chatStatus: ChatStatus;
  transport: Transport;
  /** Show Nexconn messages (true) or the fairness log rebuilt as receipts (false). */
  feedFromChat: boolean;
  /** Banner over the chat when it is not live; null when everything is connected. */
  chatNote: string | null;
  buyer: Buyer | null;
  session: SessionInfo | undefined;
  pinned: RoomItem | null;
  open: RoomItem[];
  lineup: PublicItem[];
  myClaims: QueueEntry[];
  /** `${itemCode}-${position}` for each of my claims, to spot them in the public log. */
  mineKeys: Set<string>;
  feed: ChatMessage[];
  nameOf: NameOf;
  /** Milliseconds the local clock runs ahead of the server. */
  clockDelta: number;
  claim: ClaimController;
  demo: boolean;
  refresh: () => void;
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function fetchRoom(slug: string) {
  return unwrap(api.GET("/api/v1/rooms/{slug}", { params: { path: { slug } } }));
}

/** Rebuild the snapshot document from open channel metadata, if the server has written it. */
function snapshotFromMeta(metadata: Record<string, string>, base: Snapshot): Snapshot | null {
  const at = readMeta<number>(metadata, "at");
  if (!at) return null;
  return {
    status: readMeta<Snapshot["status"]>(metadata, "status") ?? base.status,
    title: readMeta<string>(metadata, "title") ?? base.title,
    streamUrl: "streamUrl" in metadata ? readMeta<string | null>(metadata, "streamUrl") : base.streamUrl,
    pinned: "pinned" in metadata ? readMeta<ItemState | null>(metadata, "pinned") : base.pinned,
    open: readMeta<ItemState[]>(metadata, "open") ?? base.open,
    claims: readMeta<number>(metadata, "claims") ?? base.claims,
    at,
  };
}

function withPhotos(state: ItemState, data: RoomView): RoomItem {
  const known = data.openItems.find((i) => i.id === state.id) ?? data.lineup.find((i) => i.id === state.id);
  const photos = [state.imagePath ?? known?.imagePath, ...(known?.galleryPaths ?? [])].filter((p): p is string => Boolean(p));
  return { ...state, photos: [...new Set(photos)], description: known?.description ?? null, free: state.pricePaise === 0 };
}

export function useRoomModel(slug: string, demo: boolean): { model: RoomModel | null; pending: boolean; error: boolean } {
  const queryClient = useQueryClient();
  const toast = useToast();
  const signIn = useSignIn();
  const session = useSession();
  const buyer = buyerOf(session.data);
  const chatLive = session.data?.chatLive ?? false;

  // Poll quickly while the room has no live connection, slowly once Nexconn pushes changes.
  const pollMs = useRef(2_500);
  const room = useQuery({
    queryKey: keys.room(slug),
    queryFn: () => fetchRoom(slug),
    refetchInterval: () => pollMs.current,
  });
  const apiSnapshot = (room.data?.snapshot ?? null) as Snapshot | null;
  const liveNow = apiSnapshot?.status === "live";

  // The open channel exists only while the drop is live. Before that we still connect, so every
  // visitor (signed out ones as read-only viewers) is a connected Nexconn user.
  useChatConnection(chatLive);
  const chat = useOpenChannel(liveNow ? (room.data?.live.nexconnChannelId ?? null) : null, chatLive);
  const transport: Transport = chat.joined ? "live" : "api";

  const snapshot = useMemo<Snapshot | null>(() => {
    if (!apiSnapshot) return null;
    const fromMeta = snapshotFromMeta(chat.metadata, apiSnapshot);
    // Both documents carry the server time they were written; the newer one wins.
    return fromMeta && fromMeta.at >= (apiSnapshot.at ?? 0) ? fromMeta : apiSnapshot;
  }, [apiSnapshot, chat.metadata]);
  const status = snapshot?.status ?? "draft";

  pollMs.current =
    status === "ended" ? 60_000 : status === "draft" ? 8_000 : transport === "live" ? 15_000 : demo || room.data?.shop.isDemo ? 1_500 : 2_500;

  // Clock offset from the API's own timestamp, used until Nexconn's server clock is available.
  const clockFallback = apiSnapshot?.at ? room.dataUpdatedAt - apiSnapshot.at : 0;

  // Any new message in the room (a receipt, a drop) may change my claims: refresh them.
  const lastMessageId = chat.messages.at(-1)?.id;
  useEffect(() => {
    if (lastMessageId) void queryClient.invalidateQueries({ queryKey: keys.room(slug) });
  }, [lastMessageId, queryClient, slug]);
  // When the live state says the room moved on (started, ended), fetch the full view again.
  useEffect(() => {
    if (snapshot && apiSnapshot && snapshot.status !== apiSnapshot.status) void queryClient.invalidateQueries({ queryKey: keys.room(slug) });
  }, [snapshot, apiSnapshot, queryClient, slug]);

  // Refusals from the pre-messaging webhook arrive only to the sender, with the reason in `extra`.
  const blockedIds = useRef(new Set<string>());
  useEffect(() => {
    const b = chat.lastBlocked;
    if (!b) return;
    blockedIds.current.add(b.messageId);
    const outcome = b.payload?.outcome;
    if (outcome === "waitlisted") {
      toast(b.reason ?? "You're in line.", "info");
      void queryClient.invalidateQueries({ queryKey: keys.room(slug) });
    } else if (outcome === "sign_in") {
      toast(b.reason ?? "Sign in to chat and claim.", "info");
    } else {
      toast(b.reason ?? "That message was not sent.", "error");
    }
  }, [chat.lastBlocked, queryClient, slug, toast]);

  const myClaims = room.data?.myClaims ?? [];

  // Tell the buyer when the line moves to them.
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    for (const c of myClaims) {
      const before = previous.current.get(c.claimId);
      if (before === "waitlisted" && c.status === "held" && !demo) {
        toast(`${c.itemCode} moved to you. Pay to keep it.`, "success");
      }
      previous.current.set(c.claimId, c.status);
    }
  }, [myClaims, demo, toast]);

  // --- Claiming ---------------------------------------------------------------------------------
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [last, setLast] = useState<ClaimController["last"]>(null);

  const announce = useCallback(
    (code: string, outcome: ClaimResult["outcome"], position: number | null, free: boolean) => {
      setLast({ code, outcome, position, at: Date.now() });
      if (demo) return;
      if (outcome === "held") toast(free ? `You won ${code}!` : `${code} is yours. Pay to keep it.`, "success");
      else if (outcome === "waitlisted") toast(`You're #${position} in line for ${code}.`, "info");
      else if (outcome === "already") toast(`You're already #${position} for ${code}.`, "info");
      else if (outcome === "hold_limit") toast("Pay for one of your holds to claim more.", "error");
      else if (outcome === "closed") toast(`Claims for ${code} just closed.`, "error");
      else if (outcome === "blocked") toast("This shop isn't taking claims from your account.", "error");
      else if (outcome === "no_item") toast("Nothing is up for claims right now.", "error");
      else if (outcome === "not_live") toast("This live has ended.", "error");
    },
    [demo, toast],
  );

  const claimByApi = useCallback(
    async (code: string) => {
      const result = await unwrap(api.POST("/api/v1/rooms/{slug}/claims", { params: { path: { slug } }, body: { code } }));
      const item = (room.data?.openItems ?? []).find((i) => i.code === code);
      announce(result.itemCode ?? code, result.outcome, result.position ?? null, item?.pricePaise === 0);
      void queryClient.invalidateQueries({ queryKey: keys.room(slug) });
      void queryClient.invalidateQueries({ queryKey: keys.fairness(slug) });
    },
    [announce, queryClient, room.data?.openItems, slug],
  );

  const claim = useCallback(
    async (code: string) => {
      if (pendingCode) return;
      let me = buyer;
      if (!me) {
        // In the demo shop a visitor races straight away as a guest; real shops need a sign-in.
        if (room.data?.shop.isDemo && session.data?.demo) {
          try {
            const fresh = await unwrap(api.POST("/api/v1/demo/join"));
            await resetChat();
            queryClient.setQueryData(keys.session, fresh);
            me = buyerOf(fresh);
          } catch (e) {
            toast(errorMessage(e), "error");
            return;
          }
        } else {
          signIn({
            reason: `So ${room.data?.shop.displayName ?? "the shop"} knows a real person claimed. The room shows only your first name and initial.`,
          });
          return;
        }
      }
      if (!me) return;
      setPendingCode(code);
      try {
        if (chat.joined) {
          // Claim through Nexconn: the server's pre-messaging webhook orders claims by the time
          // Nexconn received them and rewrites this message into everyone's receipt.
          let sent: ChatMessage | null = null;
          try {
            sent = await chat.send("mine", { payload: { t: "claim", code }, senderName: me.displayName });
          } catch {
            sent = null;
          }
          if (sent) {
            // Never treat a sent message as a win: wait for the server's decision, and if it does
            // not show (the webhook fails open under load), claim through the API, which answers
            // "already" when the chat claim did land.
            for (const wait of [600, 1200, 2200]) {
              await sleep(wait);
              if (blockedIds.current.has(sent.id)) return;
              const fresh = await queryClient.fetchQuery({ queryKey: keys.room(slug), queryFn: () => fetchRoom(slug), staleTime: 0 });
              const entry = fresh.myClaims.find((c) => c.itemCode === code && isActive(c));
              if (entry) {
                const free = fresh.openItems.find((i) => i.code === code)?.pricePaise === 0;
                announce(code, entry.status === "waitlisted" ? "waitlisted" : "held", entry.position, free);
                return;
              }
            }
          }
        }
        await claimByApi(code);
      } catch (e) {
        toast(errorMessage(e), "error");
      } finally {
        setPendingCode(null);
      }
    },
    [announce, buyer, chat, claimByApi, pendingCode, queryClient, room.data?.shop, session.data?.demo, signIn, slug, toast],
  );

  const data = room.data;
  const model = useMemo<RoomModel | null>(() => {
    if (!data || !snapshot) return null;
    const pinned = snapshot.pinned ? withPhotos(snapshot.pinned, data) : null;
    const open = snapshot.open.map((i) => withPhotos(i, data));
    const nameOf: NameOf = (userId) => {
      if (userId === data.shop.cohostUserId) return { name: "Co-host", role: "cohost" };
      if (roleOf(userId) === "staff") return { name: data.shop.displayName, role: "shop" };
      if (buyer && userId === buyer.nexconnUserId) return { name: buyer.displayName, role: "buyer" };
      const fromMessage = chat.messages.find((m) => m.senderId === userId && m.senderName)?.senderName;
      return { name: fromMessage ?? "Buyer", role: "buyer" };
    };
    // My own Claim taps become receipts as soon as the server's decision is known.
    const feed = chat.messages.map((m) => {
      if (m.payload?.t !== "claim" || !buyer || m.senderId !== buyer.nexconnUserId) return m;
      const code = m.payload.code ?? pinned?.code;
      const entry = data.myClaims.find((c) => c.itemCode === code && isActive(c));
      if (!entry) return m;
      return {
        ...m,
        payload: {
          t: "receipt" as const,
          source: "button" as const,
          said: "Claim",
          buyerName: buyer.displayName,
          outcome: entry.status,
          itemCode: entry.itemCode,
          position: entry.position,
          status: entry.status,
        },
      };
    });
    const feedFromChat = transport === "live" || (chat.status === "offline" && chat.messages.length > 0);
    const chatNote =
      transport === "live"
        ? null
        : !chatLive
          ? "Chat is off in this preview. Every claim still shows here as it happens."
          : chat.status === "offline"
            ? "Reconnecting to chat. Claims still work."
            : chat.status === "error"
              ? `${chatError() ?? "Chat is full right now."} Every claim still shows here.`
              : "Connecting to chat. Claims show here as they happen.";
    return {
      slug,
      data,
      snapshot,
      status: snapshot.status,
      chat,
      chatStatus: chat.status,
      transport,
      feedFromChat,
      chatNote,
      buyer,
      session: session.data,
      pinned,
      open,
      lineup: data.lineup,
      myClaims: data.myClaims,
      mineKeys: new Set(data.myClaims.map((c) => `${c.itemCode}-${c.position}`)),
      feed,
      nameOf,
      clockDelta: clockFallback,
      claim: { pendingCode, claim, last },
      demo,
      refresh: () => void queryClient.invalidateQueries({ queryKey: keys.room(slug) }),
    };
  }, [data, snapshot, buyer, chat, transport, chatLive, slug, session.data, clockFallback, pendingCode, claim, last, demo, queryClient]);

  return { model, pending: room.isPending || session.isPending, error: room.isError };
}

/** Milliseconds left until `until` on the server's clock (0 once passed). */
export function useServerCountdown(until: string | null | undefined, clockDelta: number): number {
  const now = useServerNow(clockDelta, 500);
  if (!until) return 0;
  return Math.max(0, new Date(until).getTime() - now);
}

const desktopQuery = "(min-width: 1024px)";

/** True on wide screens, where the room shows the Twitch layout instead of the phone overlay. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(desktopQuery);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  );
}

/** The claim to show for an item: holding, waiting or bought. */
export function myClaimFor(model: RoomModel, itemId: string | undefined): QueueEntry | undefined {
  if (!itemId) return undefined;
  return model.myClaims.find((c) => c.itemId === itemId && isActive(c));
}
