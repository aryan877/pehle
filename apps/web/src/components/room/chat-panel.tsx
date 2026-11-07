import { ArrowUp, WifiOff } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { ChatAvatar, ChatFeed, PreviewClaimsFeed } from "~/components/chat-feed";
import { useSignIn } from "~/components/sign-in";
import { cx, errorMessage, useToast } from "~/components/ui";

import type { RoomModel } from "./model";

function Feed({ model, variant, className }: { model: RoomModel; variant: "panel" | "overlay"; className?: string }) {
  if (model.feedFromChat) {
    return (
      <ChatFeed
        className={className}
        variant={variant}
        messages={model.feed}
        nameOf={model.nameOf}
        myUserId={model.buyer?.nexconnUserId ?? null}
        empty="Say hi. Type mine or an item code to claim."
      />
    );
  }
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <PreviewClaimsFeed
        slug={model.slug}
        myName={model.buyer?.displayName ?? ""}
        mineKeys={model.mineKeys}
        nameOf={model.nameOf}
        variant={variant}
        note={null}
        pollMs={model.demo ? 1_500 : 2_500}
      />
    </div>
  );
}

function ChatNote({ model, glass }: { model: RoomModel; glass?: boolean }) {
  if (!model.chatNote) return null;
  return (
    <p
      className={cx(
        "flex items-center gap-2 text-[12px] leading-snug",
        glass
          ? "mx-1 mb-1 self-start rounded-full bg-black/50 px-2.5 py-1 text-white/85 backdrop-blur"
          : "shrink-0 border-b border-line bg-surface-2 px-3 py-2 text-fg-2",
      )}
      role="status"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      {model.chatNote}
    </p>
  );
}

/** Desktop: the chat column, laid out like YouTube's live chat. */
export function ChatColumn({ model }: { model: RoomModel }) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-[#0f0f0f]" aria-label="Live chat">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <h2 className="text-[16px] font-medium text-white">Live chat</h2>
        {model.transport === "live" ? null : <span className="text-[12px] text-[#aaaaaa]">Claims only</span>}
      </div>
      <ChatNote model={model} />
      <Feed model={model} variant="panel" className="flex-1" />
      <Pinned model={model} />
      <Composer model={model} />
    </aside>
  );
}

/** The pinned banner YouTube sellers use for a booking number; here it says how the line works. */
function Pinned({ model }: { model: RoomModel }) {
  if (model.status !== "live") return null;
  return (
    <div className="mx-3 mb-2 flex shrink-0 items-center gap-2.5 rounded-full bg-[#272727] py-1.5 pl-1.5 pr-4 text-[13px] leading-5">
      <ChatAvatar name={model.data.shop.displayName} size={28} />
      <span className="shrink-0 rounded-full bg-[#f1f1f1] px-1.5 font-medium text-[#0f0f0f]">{model.data.shop.displayName}</span>
      <span className="truncate text-white">📌 Type mine. First claim gets it.</span>
    </div>
  );
}

/** Phones: chat floats over the stream, newest at the bottom, fading out at the top. */
export function PhoneChat({ model, className }: { model: RoomModel; className?: string }) {
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <Feed model={model} variant="overlay" className="min-h-0 flex-1" />
      <ChatNote model={model} glass />
    </div>
  );
}

/** Message box. Signed-out visitors get one button to sign in instead. */
export function Composer({ model, glass }: { model: RoomModel; glass?: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const signIn = useSignIn();
  const input = useRef<HTMLInputElement>(null);
  const ended = model.status === "ended";
  const canSend = Boolean(model.buyer) && model.chat.joined && model.status === "live";

  if (!model.buyer && !ended) {
    return (
      <div className={cx("shrink-0", glass ? "" : "border-t border-white/10 px-3 pb-3 pt-2.5")}>
        <button
          onClick={() =>
            signIn({ reason: `Sign in to chat with ${model.data.shop.displayName} and claim. The room shows only your first name and initial.` })
          }
          className={cx(
            "flex h-10 w-full items-center justify-center rounded-full text-[14px] font-semibold",
            glass ? "bg-black/55 text-white backdrop-blur" : "bg-[#272727] text-white hover:bg-[#3f3f3f]",
          )}
        >
          Sign in to chat
        </button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || !canSend) return;
    setSending(true);
    try {
      await model.chat.send(value, { senderName: model.buyer?.displayName });
      setText("");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };
  const placeholder = ended ? "This live has ended" : !model.chat.joined ? "Chat is offline right now" : "Chat... type mine to claim";
  return (
    <form onSubmit={submit} className={cx("flex shrink-0 items-center gap-2.5", glass ? "" : "border-t border-white/10 px-4 pb-3 pt-3")}>
      {glass ? null : <ChatAvatar name={model.buyer?.displayName ?? "You"} />}
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={!canSend}
        maxLength={400}
        aria-label="Message the room"
        enterKeyHint="send"
        className={cx(
          "h-10 min-w-0 flex-1 rounded-full px-4 text-[15px] outline-none disabled:opacity-70",
          glass
            ? "bg-black/55 text-white placeholder:text-white/60 backdrop-blur focus:bg-black/70"
            : "bg-[#272727] text-white placeholder:text-[#aaaaaa] focus:bg-[#3f3f3f]",
        )}
      />
      <button
        type="submit"
        disabled={!canSend || !text.trim() || sending}
        aria-label="Send"
        className={cx(
          "flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition active:scale-95 disabled:bg-white/15 disabled:text-white/45",
          glass && "disabled:backdrop-blur",
        )}
      >
        <ArrowUp className="size-5" strokeWidth={2.6} />
      </button>
    </form>
  );
}
