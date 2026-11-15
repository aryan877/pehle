import { Bell, BellOff, BellRing, Share } from "lucide-react";

import { useAlerts } from "~/lib/push";
import { useSession } from "~/lib/session";

import { Button, cx } from "./ui";

/**
 * "Turn on alerts", offered right after something worth being told about: Remind me, Join club,
 * or a claim that might move to you. Hidden when alerts are already on or the browser cannot do
 * them; on an iPhone outside the Home Screen app it explains how to get them.
 */
export function AlertsPrompt({
  title,
  body,
  className,
  compact,
}: {
  /** What the alert will be about, for example "We'll tell you if it moves to you". */
  title: string;
  body?: string;
  className?: string;
  /** One line with a button, for tight spots like the phone room. */
  compact?: boolean;
}) {
  const session = useSession();
  const signedIn = session.data?.me.kind === "buyer" || session.data?.me.kind === "staff";
  const { state, busy, error, enable } = useAlerts(session.data?.pushKey, signedIn);

  if (!signedIn || state === "checking" || state === "unsupported" || state === "unconfigured") return null;

  if (state === "on") {
    if (compact) return null;
    return (
      <p className={cx("flex items-center gap-2 text-[13px] font-semibold text-good", className)} role="status">
        <BellRing className="size-4" /> Alerts are on for this device.
      </p>
    );
  }

  if (state === "install") {
    return (
      <div className={cx("flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-[13px] leading-snug", className)}>
        <Share className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <p className="text-fg-2">
          <b className="text-fg">{title}.</b> On iPhone, tap Share, then Add to Home Screen, and open Pehle from there to get alerts.
        </p>
      </div>
    );
  }

  if (state === "denied") {
    if (compact) return null;
    return (
      <p className={cx("flex items-start gap-2 text-[13px] text-muted", className)}>
        <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden /> Alerts are blocked for Pehle in this browser. Allow notifications in site settings
        to get them.
      </p>
    );
  }

  if (compact) {
    return (
      <div className={cx("flex items-center gap-2 rounded-xl bg-black/50 py-1.5 pl-3 pr-1.5 text-[13px] backdrop-blur", className)}>
        <Bell className="size-4 shrink-0 text-gold" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-semibold text-white">{title}</span>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void enable()} className="h-7 shrink-0 px-2.5 text-[12px]">
          Turn on alerts
        </Button>
      </div>
    );
  }

  return (
    <div className={cx("flex items-center gap-3 rounded-xl bg-surface-2 p-3", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold" aria-hidden>
        <Bell className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">{title}</p>
        <p className="text-[13px] leading-snug text-muted">{error ?? body ?? "Get a browser alert, even when this tab is closed."}</p>
      </div>
      <Button size="sm" loading={busy} onClick={() => void enable()} className="shrink-0">
        Turn on alerts
      </Button>
    </div>
  );
}
