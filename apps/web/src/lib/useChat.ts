import {
  BaseChannel,
  ChannelType,
  DirectChannel,
  DirectChannelIdentifier,
  GroupChannel,
  GroupChannelIdentifier,
  OpenChannel,
  SendTextMessageParams,
  type MessagesQuery,
} from "@nexconn/chat";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  chatEvents,
  chatStatus,
  connectChat,
  retryChat,
  serverTimeDelta,
  toChatMessage,
  type ChatMessage,
  type ChatStatus,
  type Payload,
  type RefusedPayload,
} from "./chat";

export function useChatStatus(): ChatStatus {
  return useSyncExternalStore((notify) => chatEvents.status.on(notify), chatStatus, chatStatus);
}

let retries = 0;

/**
 * Keep the tab's single connection alive while `enabled`: connect when idle (first visit, or after
 * a sign-in reset the identity) and retry a failed connection with backoff, so a drop that was full
 * lets people back in as others leave.
 */
export function useChatConnection(enabled: boolean): ChatStatus {
  const status = useChatStatus();
  useEffect(() => {
    if (!enabled || status !== "idle") return;
    void connectChat().catch(() => undefined);
  }, [enabled, status]);
  useEffect(() => {
    if (status === "connected") retries = 0;
    if (!enabled || status !== "error" || retries >= 4) return;
    const id = window.setTimeout(
      () => {
        retries++;
        void retryChat().catch(() => undefined);
      },
      15_000 * 2 ** retries,
    );
    return () => window.clearTimeout(id);
  }, [enabled, status]);
  return status;
}

function upsert(list: ChatMessage[], message: ChatMessage, max = 300): ChatMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index >= 0) {
    const next = list.slice();
    next[index] = message;
    return next;
  }
  const next = [...list, message].sort((a, b) => a.sentTime - b.sentTime);
  return next.length > max ? next.slice(next.length - max) : next;
}

function extraFor(payload?: Payload) {
  return payload ? JSON.stringify({ pehle: payload }) : undefined;
}

export interface BlockedNotice {
  messageId: string;
  reason: string | null;
  payload: RefusedPayload | null;
  at: number;
}

export interface OpenChannelState {
  status: ChatStatus;
  /** True once this tab has entered the open channel and can send. */
  joined: boolean;
  messages: ChatMessage[];
  /** Raw metadata strings keyed by name (values are JSON documents written by the server). */
  metadata: Record<string, string>;
  participants: number | null;
  /** Send a message; resolves with the sent message. */
  send: (text: string, options?: { payload?: Payload; senderName?: string }) => Promise<ChatMessage | null>;
  lastBlocked: BlockedNotice | null;
  error: string | null;
}

/** Join a Nexconn open channel and keep its messages, metadata and head count in React state. */
export function useOpenChannel(channelId: string | null, enabled: boolean): OpenChannelState {
  const status = useChatConnection(enabled && Boolean(channelId));
  const connected = status === "connected";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<number | null>(null);
  const [lastBlocked, setLastBlocked] = useState<BlockedNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const channelRef = useRef<OpenChannel | null>(null);

  useEffect(() => {
    if (!channelId || !enabled) return;
    const offs = [
      chatEvents.message.on((m) => m.channelId === channelId && setMessages((list) => upsert(list, m))),
      chatEvents.updated.on((m) => m.channelId === channelId && setMessages((list) => upsert(list, m))),
      chatEvents.metadata.on((c) => {
        if (c.channelId !== channelId) return;
        setMetadata((current) => {
          const next = { ...current };
          if (c.deleted) delete next[c.key];
          else next[c.key] = c.value;
          return next;
        });
      }),
      chatEvents.participants.on((p) => p.channelId === channelId && setParticipants(p.count)),
      chatEvents.blocked.on((b) => {
        if (b.channelId !== channelId) return;
        // The refused message never reached the room, so it should not sit in our feed either.
        setMessages((list) => list.filter((m) => m.id !== b.messageId));
        setLastBlocked({ messageId: b.messageId, reason: b.reason, payload: b.payload, at: Date.now() });
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [channelId, enabled]);

  // Enter while connected. After a reconnect we enter again and re-read the metadata, because
  // change notifications can be dropped while offline.
  useEffect(() => {
    if (!channelId || !enabled || !connected) return;
    let cancelled = false;
    const channel = new OpenChannel(channelId);
    channelRef.current = channel;
    (async () => {
      try {
        const entered = await channel.enterChannel({ messageCount: 40 });
        if (cancelled) return;
        if (!entered.isOk) {
          setError(`Could not join the room chat (${entered.code}). Claims still work.`);
          return;
        }
        setError(null);
        setJoined(true);
        setParticipants(entered.data?.participantCount ?? null);
        const meta = await channel.getMetadata();
        if (!cancelled && meta.isOk && meta.data) setMetadata(meta.data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Chat is unavailable.");
      }
    })();
    return () => {
      cancelled = true;
      setJoined(false);
      channel.exitChannel().catch(() => undefined);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [channelId, enabled, connected]);

  const send = useCallback(async (text: string, options?: { payload?: Payload; senderName?: string }) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("Chat is not connected yet.");
    const senderUserInfo = options?.senderName ? { name: options.senderName } : undefined;
    const result = await channel.sendMessage(new SendTextMessageParams({ text, extra: extraFor(options?.payload), senderUserInfo }));
    if (!result.isOk) throw new Error(`Message not sent (${result.code}).`);
    if (!result.data) return null;
    const sent = toChatMessage(result.data);
    setMessages((list) => upsert(list, sent));
    return sent;
  }, []);

  return { status, joined: joined && connected, messages, metadata, participants, send, lastBlocked, error };
}

export interface DirectChannelState {
  status: ChatStatus;
  messages: ChatMessage[];
  send: (text: string) => Promise<void>;
}

/** The private chat with another user (the shop's co-host for buyers). */
export function useDirectChannel(targetUserId: string | null, enabled: boolean): DirectChannelState {
  const status = useChatConnection(enabled && Boolean(targetUserId));
  const connected = status === "connected";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const channelRef = useRef<DirectChannel | null>(null);

  useEffect(() => {
    if (!targetUserId || !enabled) return;
    const offs = [
      chatEvents.message.on((m) => m.channelId === targetUserId && setMessages((list) => upsert(list, m))),
      chatEvents.updated.on((m) => m.channelId === targetUserId && setMessages((list) => upsert(list, m))),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [targetUserId, enabled]);

  useEffect(() => {
    if (!targetUserId || !enabled || !connected) return;
    let cancelled = false;
    channelRef.current = new DirectChannel(targetUserId);
    (async () => {
      const query = BaseChannel.createMessagesQuery({
        channelIdentifier: new DirectChannelIdentifier(targetUserId),
        pageSize: 30,
        startTime: Date.now() - serverTimeDelta() + 60_000,
      });
      const page = await query.loadNextPage();
      if (!cancelled && page.isOk && page.data) {
        setMessages((list) => page.data!.data.reduce((acc, m) => upsert(acc, toChatMessage(m)), list));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [targetUserId, enabled, connected]);

  const send = useCallback(async (text: string) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("Chat is not connected yet.");
    const result = await channel.sendMessage(new SendTextMessageParams({ text }));
    if (!result.isOk) throw new Error(`Message not sent (${result.code}).`);
    if (result.data) setMessages((list) => upsert(list, toChatMessage(result.data!)));
  }, []);

  return { status, messages, send };
}

export interface GroupChannelState {
  status: ChatStatus;
  messages: ChatMessage[];
  /** First page of history is loading. */
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  send: (text: string, senderName?: string) => Promise<void>;
  error: string | null;
}

/**
 * A buyer↔shop conversation: a Nexconn group channel (`c…`) with the buyer, the shop team and the
 * shop's co-host. History comes from the server (Web keeps nothing locally), new messages arrive
 * live, and the thread is marked read while it is open.
 */
export function useGroupChannel(groupId: string | null, enabled: boolean): GroupChannelState {
  const status = useChatConnection(enabled && Boolean(groupId));
  const connected = status === "connected";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef<MessagesQuery | null>(null);

  useEffect(() => {
    setMessages([]);
    setHasOlder(false);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !enabled) return;
    const markRead = () => void new GroupChannel(groupId).clearUnreadCount().catch(() => undefined);
    const offs = [
      chatEvents.message.on((m) => {
        if (m.channelId !== groupId) return;
        setMessages((list) => upsert(list, m, 1000));
        if (document.visibilityState === "visible") markRead();
      }),
      chatEvents.updated.on((m) => m.channelId === groupId && setMessages((list) => upsert(list, m, 1000))),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [groupId, enabled]);

  useEffect(() => {
    if (!groupId || !enabled || !connected) return;
    let cancelled = false;
    const query = BaseChannel.createMessagesQuery({
      channelIdentifier: new GroupChannelIdentifier(groupId),
      pageSize: 30,
      isAscending: false,
      // Server time, with slack so a message sent this second is not missed.
      startTime: Date.now() - serverTimeDelta() + 60_000,
    });
    queryRef.current = query;
    setLoading(true);
    (async () => {
      const page = await query.loadNextPage();
      if (cancelled) return;
      if (!page.isOk || !page.data) {
        setError(`Could not load messages (${page.code}).`);
        return;
      }
      setError(null);
      setHasOlder(query.hasNext);
      setMessages((list) => page.data!.data.reduce((acc, m) => upsert(acc, toChatMessage(m), 1000), list));
      void new GroupChannel(groupId).clearUnreadCount().catch(() => undefined);
      chatEvents.channels.emit();
    })()
      .catch(() => !cancelled && setError("Could not load messages."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (queryRef.current === query) queryRef.current = null;
    };
  }, [groupId, enabled, connected]);

  const loadOlder = useCallback(async () => {
    const query = queryRef.current;
    if (!query || query.isLoading || !query.hasNext) return;
    setLoadingOlder(true);
    try {
      const page = await query.loadNextPage();
      if (page.isOk && page.data) {
        setMessages((list) => page.data!.data.reduce((acc, m) => upsert(acc, toChatMessage(m), 1000), list));
      }
      setHasOlder(query.hasNext);
    } finally {
      setLoadingOlder(false);
    }
  }, []);

  const send = useCallback(
    async (text: string, senderName?: string) => {
      if (!groupId || chatStatus() !== "connected") throw new Error("Chat is not connected yet.");
      const result = await new GroupChannel(groupId).sendMessage(
        new SendTextMessageParams({ text, senderUserInfo: senderName ? { name: senderName } : undefined }),
      );
      if (!result.isOk) throw new Error(`Message not sent (${result.code}).`);
      if (result.data) setMessages((list) => upsert(list, toChatMessage(result.data!), 1000));
    },
    [groupId],
  );

  return { status, messages, loading, hasOlder, loadingOlder, loadOlder, send, error };
}

export interface ChannelSummary {
  channelId: string;
  unreadCount: number;
  latest: ChatMessage | null;
}

/**
 * The signed-in person's channel list from Nexconn (Web always fetches it from the server), keyed
 * by channel ID, for unread badges and last-message previews in the inbox. Refreshes when a message
 * arrives or another device changes read state.
 */
export function useChannelList(enabled: boolean): { summaries: Record<string, ChannelSummary>; totalUnread: number; ready: boolean } {
  const status = useChatConnection(enabled);
  const connected = status === "connected";
  const [summaries, setSummaries] = useState<Record<string, ChannelSummary>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !connected) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      const query = BaseChannel.createChannelsQuery({ pageSize: 100 });
      const page = await query.loadNextPage().catch(() => null);
      if (cancelled || !page?.isOk || !page.data) return;
      const next: Record<string, ChannelSummary> = {};
      for (const channel of page.data.data) {
        if (channel.channelType !== ChannelType.GROUP) continue;
        const latest = channel.latestMessage;
        next[channel.channelId] = {
          channelId: channel.channelId,
          unreadCount: channel.unreadCount,
          latest: latest ? toChatMessage(latest) : null,
        };
      }
      setSummaries(next);
      setReady(true);
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 400);
    };
    void load();
    const offs = [chatEvents.message.on((m) => m.channelId.startsWith("c") && soon()), chatEvents.channels.on(soon)];
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const off of offs) off();
    };
  }, [enabled, connected]);

  const totalUnread = Object.values(summaries).reduce((sum, s) => sum + s.unreadCount, 0);
  return { summaries, totalUnread, ready };
}

/**
 * Server time for countdowns: Nexconn's clock when connected (`NCEngine.getServerTimeDelta()`),
 * otherwise the offset measured from the API snapshot's own timestamp. Every phone in the room then
 * counts down to the same moment, whatever its clock says.
 */
export function useServerNow(fallbackDelta: number, intervalMs = 250): number {
  const status = useChatStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  const delta = status === "connected" ? serverTimeDelta() || fallbackDelta : fallbackDelta;
  return now - delta;
}

/** Parse a JSON metadata value written by the server, tolerating missing keys. */
export function readMeta<T>(metadata: Record<string, string>, key: string): T | null {
  const raw = metadata[key];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
