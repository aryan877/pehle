import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Gift, Hourglass, Lock, PartyPopper, ShieldCheck, TimerOff } from "lucide-react";

import { AlertsPrompt } from "~/components/alerts";
import { Button, CodeChip, cx } from "~/components/ui";
import { api, keys, unwrap, type FairnessLog, type QueueEntry } from "~/lib/api";
import { clock } from "~/lib/format";

import { myClaimFor, useServerCountdown, type RoomItem, type RoomModel } from "./model";
import { priceLabel } from "./shop";

/** The public queue (fairness log). Polled fast without live chat, gently with it. */
export function useFairnessQueue(model: RoomModel, enabled = true) {
  return useQuery({
    queryKey: keys.fairness(model.slug),
    queryFn: () => unwrap(api.GET("/api/v1/rooms/{slug}/fairness", { params: { path: { slug: model.slug }, query: {} } })),
    refetchInterval: model.transport === "live" ? 10_000 : model.demo ? 1_500 : 2_500,
    enabled,
  });
}

/** People still ahead of `entry` in the line for its item. */
export function aheadOf(log: FairnessLog | undefined, entry: QueueEntry): number | null {
  if (!log) return null;
  return log.queue.filter((e) => e.itemCode === entry.itemCode && e.position < entry.position && (e.status === "held" || e.status === "waitlisted"))
    .length;
}

export function PayLink({ orderId, label = "Pay now", className }: { orderId: string; label?: string; className?: string }) {
  return (
    <Link
      to="/o/$orderId"
      params={{ orderId }}
      className={cx(
        "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-good px-4 text-[14px] font-bold text-canvas transition hover:brightness-110",
        className,
      )}
    >
      {label} <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

/** The big pink button. Becomes "Join the line" once every unit is held. */
export function ClaimButton({ model, item, className, size = "xl" }: { model: RoomModel; item: RoomItem; className?: string; size?: "lg" | "xl" }) {
  const live = model.status === "live" && item.status === "open";
  const pending = model.claim.pendingCode === item.code;
  const soldOut = item.left === 0;
  const label = !live ? "Claims are closed" : soldOut ? "Join the line" : item.free ? "Claim it free" : "Claim";
  return (
    <Button
      size={size}
      block
      disabled={!live || Boolean(model.claim.pendingCode && !pending)}
      loading={pending}
      onClick={() => void model.claim.claim(item.code)}
      className={cx(
        "relative overflow-hidden font-extrabold tracking-tight shadow-glow",
        size === "xl" ? "h-14 text-[18px]" : "text-[16px]",
        live && !pending && "animate-pulse-ring",
        className,
      )}
      aria-describedby={`rule-${item.code}`}
    >
      {live && !pending ? <span className="shine pointer-events-none absolute inset-0 animate-shine" aria-hidden /> : null}
      <span className="relative inline-flex items-center gap-2">
        {pending ? "Checking your place" : label}
        {live && !pending ? <CodeChip code={item.code} className="text-[12px]" /> : null}
      </span>
    </Button>
  );
}

export function claimRule(item: RoomItem, holdMinutes: number) {
  if (item.free) return "First to claim wins it.";
  if (item.left === 0) return "If someone ahead doesn't pay in time, it's offered to the next person automatically.";
  return `First to claim gets ${holdMinutes} minutes to pay.`;
}

/** Units as bars: sold, held, still free. */
export function StockBar({ item, glass }: { item: RoomItem; glass?: boolean }) {
  const taken = item.held + item.paid;
  const bars = Math.min(item.quantity, 12);
  return (
    <div className="flex h-1.5 max-w-xs gap-1" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cx("flex-1 rounded-full", i < item.paid ? "bg-fg-2" : i < taken ? "bg-good" : glass ? "bg-white/25" : "bg-surface-3")}
        />
      ))}
    </div>
  );
}

export function stockText(item: RoomItem): string {
  if (item.left > 0) return item.quantity === 1 ? "1 piece, still free" : `${item.left} of ${item.quantity} left`;
  if (item.paid >= item.quantity) return item.quantity === 1 ? "Sold" : "All sold";
  return item.quantity === 1 ? "Claimed" : "All claimed";
}

export function waitText(item: RoomItem): string {
  if (!item.waitlist) return "No one in line yet";
  return item.waitlist === 1 ? "1 person in line" : `${item.waitlist} people in line`;
}

/** What happened to my claim on this item, and what to do next. */
export function MyStatus({ model, entry, item, glass }: { model: RoomModel; entry: QueueEntry; item: RoomItem | null; glass?: boolean }) {
  const left = useServerCountdown(entry.holdExpiresAt, model.clockDelta);
  const fairness = useFairnessQueue(model, entry.status === "waitlisted");
  const free = item?.free ?? false;
  const paid = entry.status === "paid";
  const order = useQuery({
    queryKey: keys.order(entry.orderId ?? "none"),
    queryFn: () => unwrap(api.GET("/api/v1/orders/{order_id}", { params: { path: { order_id: entry.orderId! } } })),
    enabled: Boolean(entry.orderId) && paid,
  });
  const box = glass ? "rounded-xl bg-black/55 p-3 text-white backdrop-blur" : "rounded-xl p-3";

  if (paid) {
    const note = order.data?.winnerNote;
    return (
      <div className={cx(box, !glass && "bg-good-soft")} role="status">
        <p className="flex items-center gap-2 text-[16px] font-extrabold text-good">
          {free ? <Gift className="size-5" aria-hidden /> : <PartyPopper className="size-5" aria-hidden />}
          {free ? `You won ${entry.itemCode}` : `You bought ${entry.itemCode}`}
        </p>
        {note ? (
          <div className={cx("mt-2 rounded-lg border border-good/30 p-2.5", glass ? "bg-black/40" : "bg-canvas/60")}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-good">
              <Lock className="size-3" aria-hidden /> Only you can see this
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-[14px]">{note}</p>
          </div>
        ) : free ? null : (
          <p className={cx("mt-1 text-[13px]", glass ? "text-white/75" : "text-fg-2")}>Paid. The shop has your order.</p>
        )}
        {entry.orderId ? (
          <Link
            to="/o/$orderId"
            params={{ orderId: entry.orderId }}
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-good hover:underline"
          >
            View order <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    );
  }

  if (entry.status === "held") {
    const reported = entry.orderStatus === "payment_reported";
    const urgent = left > 0 && left < 60_000;
    return (
      <div className={cx(box, !glass && "bg-good-soft")} role="status">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold text-good">It's yours, #{entry.position}</p>
            <p className={cx("text-[13px]", glass ? "text-white/80" : "text-fg-2")}>
              {reported ? (
                "Payment reported. The shop is checking it."
              ) : (
                <>
                  Pay in <b className={cx("tabular font-mono", urgent ? "text-accent" : glass ? "text-white" : "text-fg")}>{clock(left)}</b> or it
                  goes to the next person
                </>
              )}
            </p>
          </div>
          {entry.orderId ? <PayLink orderId={entry.orderId} label={reported ? "View order" : "Pay now"} /> : null}
        </div>
      </div>
    );
  }

  // Waitlisted.
  const sold = Boolean(item && item.paid >= item.quantity);
  const ahead = sold ? null : aheadOf(fairness.data, entry);
  return (
    <div className={cx(box, !glass && "bg-gold-soft")} role="status">
      <div className="flex items-center gap-3">
        <span className="tabular flex size-12 shrink-0 items-center justify-center rounded-full bg-gold font-display text-xl font-extrabold text-canvas">
          #{entry.position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-gold">
            You're in line{ahead !== null ? (ahead === 0 ? ", next up" : `, ${ahead} ahead of you`) : ""}
          </p>
          <p className={cx("text-[13px] leading-snug", glass ? "text-white/80" : "text-fg-2")}>
            {sold
              ? "It sold, because the people ahead paid in time. You keep your place if the shop adds more."
              : "If someone ahead doesn't pay in time, it's offered to you automatically."}
          </p>
        </div>
      </div>
      <AlertsPrompt compact={glass} className={glass ? "mt-2" : "mt-3"} title="We'll tell you if it moves to you" />
    </div>
  );
}

/** A claim of mine that ended without the item (the hold ran out, or I let go). */
export function LapsedNotice({ entry }: { entry: QueueEntry }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted">
      <TimerOff className="size-4 shrink-0" aria-hidden />
      {entry.status === "expired" ? `Your hold on ${entry.itemCode} ran out, so it went to the next person.` : `You let go of ${entry.itemCode}.`}
    </p>
  );
}

/** Holds of mine on other items in this drop that still need paying. */
export function OtherHolds({ model, exceptItemId, glass }: { model: RoomModel; exceptItemId?: string; glass?: boolean }) {
  const holds = model.myClaims.filter((c) => c.status === "held" && c.orderStatus === "awaiting_payment" && c.itemId !== exceptItemId && c.orderId);
  if (!holds.length) return null;
  return (
    <div className="space-y-2">
      {holds.map((h) => (
        <OtherHold key={h.claimId} entry={h} model={model} glass={glass} />
      ))}
    </div>
  );
}

function OtherHold({ entry, model, glass }: { entry: QueueEntry; model: RoomModel; glass?: boolean }) {
  const left = useServerCountdown(entry.holdExpiresAt, model.clockDelta);
  return (
    <div className={cx("flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]", glass ? "bg-good/30 text-white backdrop-blur" : "bg-good-soft")}>
      <Hourglass className="size-4 shrink-0 text-good" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-semibold">
        <CodeChip code={entry.itemCode} className="mr-1 text-[11px]" /> held for you, <span className="tabular font-mono">{clock(left)}</span> left
      </span>
      <PayLink orderId={entry.orderId!} className="h-8 px-3 text-[13px]" />
    </div>
  );
}

/** Desktop: the item up for claims, its stock and line, and the claim area. */
export function DropPanel({ model }: { model: RoomModel }) {
  const item = model.pinned;
  const holdMinutes = model.data.shop.holdMinutes;
  if (!item) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface/70 px-4 py-4">
          <Hourglass className="size-5 shrink-0 text-muted" aria-hidden />
          <p className="flex-1 text-[14px] text-fg-2">
            <b className="text-fg">{model.status === "live" ? "Next item coming up." : "Nothing is up for claims."}</b> First to claim gets{" "}
            {holdMinutes} minutes to pay.
          </p>
        </div>
        <OtherHolds model={model} />
      </div>
    );
  }
  const mine = myClaimFor(model, item.id);
  const lapsed = !mine ? model.myClaims.find((c) => c.itemId === item.id && (c.status === "expired" || c.status === "released")) : undefined;
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-surface" aria-label="Up for claims">
      <div className="flex gap-5 p-5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-widest text-accent">
            <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden /> Up for claims
          </p>
          <h2 className="mt-1 flex items-start gap-2 text-[20px] font-bold leading-snug">
            <CodeChip code={item.code} className="mt-1 text-[13px]" />
            <span className="line-clamp-2">{item.title}</span>
          </h2>
          {item.description ? <p className="mt-1 line-clamp-2 text-[14px] text-fg-2">{item.description}</p> : null}
          <p className={cx("tabular mt-2 font-display text-[36px] font-extrabold leading-none", item.free ? "text-good" : "text-fg")}>
            {priceLabel(item.pricePaise)}
          </p>
          <div className="mt-3 space-y-1.5">
            <StockBar item={item} />
            <p className="flex flex-wrap gap-x-3 text-[13px] text-fg-2">
              <b className="text-fg">{stockText(item)}</b>
              <span className={item.waitlist ? "font-semibold text-gold" : "text-muted"}>{waitText(item)}</span>
            </p>
          </div>
        </div>
        <div className="flex w-72 shrink-0 flex-col justify-center gap-2">
          {mine ? (
            <MyStatus model={model} entry={mine} item={item} />
          ) : (
            <>
              {lapsed ? <LapsedNotice entry={lapsed} /> : null}
              <ClaimButton model={model} item={item} />
              <p id={`rule-${item.code}`} className="text-center text-[13px] text-muted">
                {claimRule(item, holdMinutes)}
              </p>
            </>
          )}
        </div>
      </div>
      <QueueStrip model={model} item={item} />
      <div className="border-t border-line px-5 py-3 empty:hidden">
        <OtherHolds model={model} exceptItemId={item.id} />
      </div>
    </section>
  );
}

/** Who is in line for the item, in order, straight from the fairness log. */
export function QueueStrip({ model, item, glass, max = 8 }: { model: RoomModel; item: RoomItem; glass?: boolean; max?: number }) {
  const log = useFairnessQueue(model);
  const entries = (log.data?.queue ?? []).filter((e) => e.itemCode === item.code).sort((a, b) => a.position - b.position);
  if (!entries.length) return null;
  const shown = entries.slice(0, max);
  return (
    <div className={cx("flex items-center gap-2 px-5 py-3", glass ? "px-0 py-0" : "border-t border-line")}>
      <ShieldCheck className={cx("size-4 shrink-0", glass ? "text-white/70" : "text-good")} aria-hidden />
      <ol className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto" aria-label={`The line for ${item.code}`}>
        {shown.map((e) => {
          const me = model.mineKeys.has(`${e.itemCode}-${e.position}`);
          const gone = e.status === "expired" || e.status === "released" || e.status === "cancelled";
          return (
            <li
              key={e.position}
              className={cx(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                e.status === "held" || e.status === "paid"
                  ? "bg-good-soft text-good"
                  : e.status === "waitlisted"
                    ? "bg-gold-soft text-gold"
                    : glass
                      ? "bg-white/10 text-white/50 line-through"
                      : "bg-surface-2 text-muted line-through",
                me && "ring-1 ring-accent",
              )}
              title={gone ? "Didn't pay in time" : undefined}
            >
              <span className="tabular">#{e.position}</span> {me ? "You" : e.buyerName}
            </li>
          );
        })}
        {entries.length > max ? <li className="shrink-0 self-center text-[12px] text-muted">+{entries.length - max} more</li> : null}
      </ol>
      <Link
        to="/fair/$slug"
        params={{ slug: model.slug }}
        className={cx("shrink-0 text-[12px] font-semibold hover:underline", glass ? "text-white/80" : "text-fg-2")}
      >
        Fairness log
      </Link>
    </div>
  );
}
