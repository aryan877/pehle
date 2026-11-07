// One Nexconn connection per tab. The server issues the token; this module initialises the SDK once,
// connects, and fans SDK events out to React hooks. In preview mode (no App Key on the server) the
// SDK is never touched and the app falls back to API polling. When connecting fails or takes too
// long (Nexconn caps concurrent connections, so a big drop can be full), the status becomes "error"
// and every screen keeps working through the API.
import { ChannelHandler, ConnectionStatusHandler, MessageHandler, NCEngine, OpenChannelHandler, type Message } from "@nexconn/chat";

import { api, unwrap } from "./api";

export type Payload =
  | {
      t: "receipt";
      source?: "youtube" | "button" | "seller" | null;
      said: string;
      buyerName: string;
      outcome: string;
      claimId?: string;
      itemId?: string;
      itemCode?: string;
      itemTitle?: string;
      position?: number;
      status?: string;
      holdExpiresAt?: string;
      unitsLeft?: number;
      waitlist?: number;
    }
  | { t: "drop"; itemId: string; code: string; title: string; pricePaise: number; quantity: number; imageUrl?: string | null }
  | {
      t: "order";
      orderId: string;
      reference: string;
      status: string;
      promoted: boolean;
      itemCode: string;
      itemTitle: string;
      imageUrl?: string | null;
      amountPaise: number;
      holdExpiresAt?: string | null;
      upiUrl?: string | null;
      orderUrl: string;
    }
  | { t: "cohost"; replyTo?: string; buyerName?: string; approvalId?: string }
  | { t: "claim"; code?: string }
  | { t: "live"; slug: string; url: string }
  | { t: "payment_reported"; orderId: string; orderUrl: string }
  | { t: "approval"; approvalId: string; kind: string }
  | { t: "joined" }
  | { t: "refused"; outcome: string; message: string; position?: number; itemCode?: string }
  | {
      t: "activity";
      kind: "live" | "drop" | "won";
      slug: string;
      shopHandle: string;
      shopName: string;
      title?: string;
      itemCode?: string;
      itemTitle?: string;
      pricePaise?: number;
      buyerName?: string;
      imageUrl?: string | null;
    };

export type RefusedPayload = Extract<Payload, { t: "refused" }>;

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName?: string;
  sentTime: number;
  text: string;
  payload: Payload | null;
  mine: boolean;
}

export type ChatStatus = "idle" | "connecting" | "connected" | "preview" | "offline" | "error";

/** Who a chat user ID belongs to, from its one-letter prefix (letters and digits only). */
export type ChatRole = "staff" | "buyer" | "cohost" | "viewer";

export function roleOf(userId: string): ChatRole | null {
  if (!/^[tuhv][0-9a-f]{32}$/.test(userId)) return null;
  return ({ t: "staff", u: "buyer", h: "cohost", v: "viewer" } as const)[userId[0] as "t" | "u" | "h" | "v"];
}

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(listener: Listener<T>) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  emit(value: T) {
    for (const l of this.listeners) l(value);
  }
}

export interface BlockedEvent {
  messageId: string;
  channelId: string;
  /** The refusal text written by the server for the sender, when there is one. */
  reason: string | null;
  payload: RefusedPayload | null;
}

export const chatEvents = {
  message: new Emitter<ChatMessage>(),
  updated: new Emitter<ChatMessage>(),
  metadata: new Emitter<{ channelId: string; key: string; value: string; deleted: boolean }>(),
  participants: new Emitter<{ channelId: string; count: number }>(),
  blocked: new Emitter<BlockedEvent>(),
  status: new Emitter<ChatStatus>(),
  /** Unread counts or the channel list changed on the server (another device read a thread). */
  channels: new Emitter<void>(),
};

export interface ChatSession {
  userId: string;
  live: boolean;
}

let state: { status: ChatStatus; userId: string | null; promise: Promise<ChatSession> | null; session: ChatSession | null } = {
  status: "idle",
  userId: null,
  promise: null,
  session: null,
};
let lastError: string | null = null;
let generation = 0;

/** A slow connection should not hold the room hostage: after this the API path takes over. */
const CONNECT_TIMEOUT_MS = 10_000;

function setStatus(status: ChatStatus) {
  if (state.status === status) return;
  state.status = status;
  chatEvents.status.emit(status);
}

export function chatStatus(): ChatStatus {
  return state.status;
}

export function currentChatUser(): string | null {
  return state.userId;
}

/** Why the last connection attempt failed, written for the person using the app. */
export function chatError(): string | null {
  return lastError;
}

/**
 * Milliseconds the local clock runs ahead of Nexconn's server clock (`Date.now() - serverTime`),
 * or 0 when not connected. Server time is `Date.now() - serverTimeDelta()`.
 */
export function serverTimeDelta(): number {
  if (state.status !== "connected") return 0;
  try {
    const delta = NCEngine.getServerTimeDelta();
    return Number.isFinite(delta) ? delta : 0;
  } catch {
    return 0;
  }
}

function readPayload(extra: unknown): Payload | null {
  if (typeof extra !== "string" || !extra) return null;
  try {
    const parsed = JSON.parse(extra) as { pehle?: Payload };
    return parsed.pehle ?? null;
  } catch {
    return null;
  }
}

export function toChatMessage(message: Message): ChatMessage {
  const content = (message.content ?? {}) as { text?: string; content?: string; extra?: string; senderUserInfo?: { name?: string } };
  return {
    id: message.messageId,
    channelId: message.channelIdentifier.channelId,
    senderId: message.senderUserId,
    senderName: content.senderUserInfo?.name,
    sentTime: message.sentTime,
    text: content.text ?? content.content ?? "",
    payload: readPayload(content.extra),
    mine: message.senderUserId === state.userId,
  };
}

let handlersInstalled = false;

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  NCEngine.addConnectionStatusHandler(
    "pehle",
    new ConnectionStatusHandler({
      onConnectionStatusChanged({ status, code }) {
        // Ignore the tail of a connection we already dropped (sign-out, identity change).
        if (state.status === "idle" || state.status === "preview") return;
        if (status === 0) {
          lastError = null;
          // A connection that finished after our timeout still counts.
          if (!state.promise && state.session) state.promise = Promise.resolve(state.session);
          setStatus("connected");
        } else if (status === 1) {
          setStatus("connecting");
        } else if (code === 31010) {
          // Kicked because the same person connected from another device or tab.
          lastError = "Chat moved to your other tab or device.";
          state.promise = null;
          setStatus("error");
        } else {
          // Disconnected or suspended: the SDK retries on its own every few seconds.
          setStatus("offline");
        }
      },
    }),
  );
  NCEngine.addMessageHandler(
    "pehle",
    new MessageHandler({
      onMessageReceived({ messages }) {
        for (const m of messages) chatEvents.message.emit(toChatMessage(m));
      },
      onMessagesUpdated({ messages }) {
        for (const m of messages) chatEvents.updated.emit(toChatMessage(m));
      },
      onMessageBlocked({ info }) {
        const payload = readPayload(info.extra);
        const refused = payload?.t === "refused" ? payload : null;
        chatEvents.blocked.emit({
          messageId: info.messageId,
          channelId: info.channelIdentifier.channelId,
          reason: refused?.message ?? null,
          payload: refused,
        });
      },
    }),
  );
  NCEngine.addOpenChannelHandler(
    "pehle",
    new OpenChannelHandler({
      onMetadataChanged({ changeInfo }) {
        for (const c of changeInfo) {
          chatEvents.metadata.emit({ channelId: c.channelId, key: c.key, value: c.value, deleted: Number(c.operationType) === 1 });
        }
      },
      onParticipantChanged({ channelId, participantCount }) {
        chatEvents.participants.emit({ channelId, count: participantCount });
      },
    }),
  );
  NCEngine.addChannelHandler(
    "pehle",
    new ChannelHandler({
      onChannelUnreadStatusSync() {
        chatEvents.channels.emit();
      },
      onChannelsSyncComplete() {
        chatEvents.channels.emit();
      },
    }),
  );
}

let initialisedKey: string | null = null;

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => window.setTimeout(() => resolve("timeout"), ms));
}

/** Connect once per tab. Safe to call from every component that needs chat. */
export function connectChat(): Promise<ChatSession> {
  if (state.promise) return state.promise;
  const mine = ++generation;
  state.promise = (async () => {
    setStatus("connecting");
    const credentials = await unwrap(api.GET("/api/v1/chat/token"));
    if (mine !== generation) throw new Error("Chat was reset.");
    state.userId = credentials.userId;
    const session: ChatSession = { userId: credentials.userId, live: credentials.live };
    state.session = session;
    if (!credentials.live) {
      setStatus("preview");
      return session;
    }
    if (initialisedKey !== credentials.appKey) {
      NCEngine.initialize({ appKey: credentials.appKey });
      initialisedKey = credentials.appKey;
    }
    installHandlers();
    const result = await Promise.race([NCEngine.connect({ token: credentials.token }), timeout(CONNECT_TIMEOUT_MS)]);
    if (mine !== generation) throw new Error("Chat was reset.");
    if (result === "timeout") {
      // If the SDK gets through later, the status handler marks us connected.
      throw new Error("Chat is busy right now. Claims still work.");
    }
    if (!result.isOk) throw new Error(`Chat is unavailable right now (${result.code}). Claims still work.`);
    lastError = null;
    setStatus("connected");
    return session;
  })().catch((error: unknown) => {
    if (mine === generation && state.status !== "connected") {
      state.promise = null;
      lastError = error instanceof Error ? error.message : "Chat is unavailable right now.";
      setStatus("error");
    }
    throw error;
  });
  return state.promise;
}

/** Try again after a failed connection. */
export function retryChat(): Promise<ChatSession> {
  if (state.status === "error") state.promise = null;
  return connectChat();
}

/** Forget the connection (sign-out or identity change). */
export async function resetChat() {
  generation++;
  const wasUsingSdk = state.status !== "idle" && state.status !== "preview" && initialisedKey !== null;
  state = { status: state.status, userId: null, promise: null, session: null };
  lastError = null;
  setStatus("idle");
  if (wasUsingSdk) await NCEngine.disconnect().catch(() => undefined);
}
