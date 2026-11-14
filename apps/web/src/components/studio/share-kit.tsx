import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, Play, Radio, Share2 } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";

import { Badge, Button, LiveDot, Sheet, WhatsAppIcon, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type Live } from "~/lib/api";
import { streamHost } from "~/lib/format";

import { CopyButton, Notice } from "./bits";
import { useShop } from "./shop-context";
import { dropTime } from "./time";

/** The public room link for a drop. The console returns the server's canonical one; this is the same path. */
export function roomLink(slug: string) {
  return `${window.location.origin}/l/${slug}`;
}

/** The message sellers paste into WhatsApp groups and Instagram stories. */
export function shareMessage({ shopName, live, url, itemCount }: { shopName: string; live: Pick<Live, "title" | "status" | "scheduledFor">; url: string; itemCount: number }) {
  if (live.status === "live") return `🔴 ${shopName} is live now: ${live.title}. Open this to claim: ${url}`;
  const when = live.scheduledFor ? ` Starts ${dropTime(live.scheduledFor, true)}.` : "";
  const lineup = itemCount ? ` ${itemCount} ${itemCount === 1 ? "item" : "items"} in the lineup, first to claim gets each one.` : " First to claim gets each item.";
  return `${shopName} drop: ${live.title}.${when}${lineup} Set a reminder and claim here: ${url}`;
}

/** Room link, QR, WhatsApp and copy, plus Go live. */
export function ShareKit({ live, roomUrl, itemCount }: { live: Live; roomUrl: string; itemCount: number }) {
  const { shop } = useShop();
  const toast = useToast();
  const qr = useRef<HTMLCanvasElement>(null);
  const message = shareMessage({ shopName: shop.displayName, live, url: roomUrl, itemCount });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const downloadQr = () => {
    const canvas = qr.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `pehle-${shop.handle}-${live.slug}-qr.png`;
    a.click();
  };

  return (
    <div className="rounded-xl bg-surface p-4 shadow-surface sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">Share kit</h2>
          <p className="text-[14px] text-fg-2">
            {live.status === "live" ? "Pin this link on your stream and in chat." : "Share it before you go live so people set a reminder."}
          </p>
        </div>
        {live.status === "live" ? (
          <Badge tone="live">
            <LiveDot /> Live
          </Badge>
        ) : live.status === "ended" ? (
          <Badge tone="muted">Ended</Badge>
        ) : (
          <Badge tone="wait">{live.scheduledFor ? dropTime(live.scheduledFor) : "Not scheduled"}</Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-xl bg-white p-2.5">
            <QRCodeCanvas ref={qr} value={roomUrl} size={148} marginSize={1} fgColor="#1c1c1d" />
          </div>
          <Button variant="ghost" size="sm" onClick={downloadQr}>
            <Download className="size-4" /> Save QR
          </Button>
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="mb-1 text-[13px] font-semibold text-fg-2">Room link</p>
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5">
              <a href={roomUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[14px] text-info hover:underline">
                {roomUrl.replace(/^https?:\/\//, "")}
              </a>
              <CopyButton text={roomUrl} label="Copy link" />
            </div>
          </div>
          <div>
            <p className="mb-1 text-[13px] font-semibold text-fg-2">Message</p>
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-fg">{message}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#1fa855] px-4 text-[15px] font-semibold text-white transition hover:brightness-110"
            >
              <WhatsAppIcon className="size-[18px]" /> WhatsApp
            </a>
            <CopyButton text={message} label="Copy message" size="md" />
            {canShare ? (
              <Button
                variant="secondary"
                onClick={() => navigator.share({ title: live.title, text: message, url: roomUrl }).catch(() => undefined)}
              >
                <Share2 className="size-4" /> More
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {live.status !== "ended" ? (
        <div className="mt-4 border-t border-line pt-4">
          <GoLiveButton live={live} onError={(m) => toast(m, "error")} />
        </div>
      ) : null}
    </div>
  );
}

/** Go live (with a short confirmation), or open the console when already live. */
export function GoLiveButton({ live, onError, size = "lg" }: { live: Live; onError: (message: string) => void; size?: "md" | "lg" }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const host = streamHost(live.streamUrl);
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/lives/{live_id}/start", { params: { path: { live_id: live.id } } })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.lives(shop.id) }),
        queryClient.invalidateQueries({ queryKey: keys.console(live.id) }),
      ]);
      toast("You're live. Open your first item when you're ready.", "success");
      await navigate({ to: "/studio/live/$liveId", params: { liveId: live.id } });
    },
    onError: (e) => {
      setConfirming(false);
      onError(errorMessage(e));
    },
  });
  if (live.status === "live") {
    return (
      <Button size={size} block onClick={() => void navigate({ to: "/studio/live/$liveId", params: { liveId: live.id } })}>
        <Radio className="size-4" /> Resume console
      </Button>
    );
  }
  return (
    <>
      <Button size={size} block onClick={() => setConfirming(true)}>
        <Play className="size-4" /> Go live
      </Button>
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={`Go live with ${live.title}?`}>
        <div className="space-y-4">
          <p className="text-fg-2">The room opens, your club gets a message, and you open items one at a time from the console.</p>
          {!live.streamUrl ? (
            <Notice tone="warn">No stream link yet. Buyers can still claim in the room, but they won't see your video there.</Notice>
          ) : host === "youtube" ? (
            <Notice tone="good">Viewers can also claim by typing the code in your YouTube chat.</Notice>
          ) : null}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button block loading={start.isPending} onClick={() => start.mutate()}>
              Go live
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
