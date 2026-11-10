import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Hourglass, ShieldCheck, TimerOff } from "lucide-react";

import { Avatar, CodeChip } from "~/components/ui";
import type { QueueEntry } from "~/lib/api";
import { mediaUrl, timeAgo } from "~/lib/format";

import { LineupGrid } from "./lineup";
import type { RoomModel } from "./model";
import { ShopCard, ShopLink } from "./shop";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-3">
      <p className="tabular font-display text-[28px] font-extrabold leading-none">{value.toLocaleString("en-IN")}</p>
      <p className="mt-1 text-[13px] text-fg-2">{label}</p>
    </div>
  );
}

function MyResult({ entry }: { entry: QueueEntry }) {
  const won = entry.status === "paid";
  const held = entry.status === "held";
  const icon = won ? (
    <CheckCircle2 className="size-5 text-good" aria-hidden />
  ) : held ? (
    <Hourglass className="size-5 text-good" aria-hidden />
  ) : entry.status === "waitlisted" ? (
    <Hourglass className="size-5 text-gold" aria-hidden />
  ) : (
    <TimerOff className="size-5 text-muted" aria-hidden />
  );
  const text = won
    ? "You got it."
    : held
      ? entry.orderStatus === "payment_reported"
        ? "Payment reported. The shop is checking it."
        : "Held for you. Pay before the hold ends."
      : entry.status === "waitlisted"
        ? `You were #${entry.position} in line. It didn't reach you this time.`
        : entry.status === "expired"
          ? "The hold ran out, so it went to the next person."
          : "You let it go.";
  return (
    <li className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      {icon}
      <CodeChip code={entry.itemCode} />
      <p className="min-w-0 flex-1 text-[14px] text-fg-2">{text}</p>
      {entry.orderId && (won || held) ? (
        <Link
          to="/o/$orderId"
          params={{ orderId: entry.orderId }}
          className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-accent hover:underline"
        >
          {held && entry.orderStatus === "awaiting_payment" ? "Pay now" : "Order"} <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

/** After the drop: what happened, what you got, and where the shop is next. */
export function EndedRoom({ model }: { model: RoomModel }) {
  const { data } = model;
  const dropped = data.lineup.filter((i) => i.status !== "ready");
  const unitsClaimed = dropped.reduce((sum, i) => sum + Math.max(0, i.quantity - i.unitsLeft), 0);
  const soldOut = dropped.filter((i) => i.unitsLeft === 0).length;
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-6">
      <section className="rounded-xl bg-surface p-4 shadow-surface sm:p-6">
        <ShopLink handle={data.shop.handle} className="flex items-center gap-2.5">
          <Avatar name={data.shop.displayName} src={mediaUrl(data.shop.avatarPath)} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{data.shop.displayName}</span>
            <span className="block text-[13px] text-muted">{data.live.endedAt ? `Ended ${timeAgo(data.live.endedAt)}` : "Ended"}</span>
          </span>
        </ShopLink>
        <h1 className="mt-4 text-balance font-display text-[28px] font-bold leading-tight">This drop has ended</h1>
        <p className="mt-1 text-[15px] text-fg-2">{data.live.title}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={dropped.length} label={dropped.length === 1 ? "item dropped" : "items dropped"} />
          <Stat value={unitsClaimed} label={unitsClaimed === 1 ? "piece claimed" : "pieces claimed"} />
          <Stat value={soldOut} label="sold out" />
          <Stat value={model.snapshot.claims} label={model.snapshot.claims === 1 ? "claim decided" : "claims decided"} />
        </div>
        <Link
          to="/fair/$slug"
          params={{ slug: model.slug }}
          className="mt-4 inline-flex items-center gap-2 text-[14px] font-semibold text-fg-2 hover:text-fg"
        >
          <ShieldCheck className="size-4 text-good" aria-hidden /> See every decision in the fairness log{" "}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      {model.myClaims.length ? (
        <section aria-labelledby="mine-title">
          <h2 id="mine-title" className="mb-3 text-[20px] font-bold">
            Your claims
          </h2>
          <ul className="space-y-2">
            {model.myClaims.map((c) => (
              <MyResult key={c.claimId} entry={c} />
            ))}
          </ul>
        </section>
      ) : null}

      <ShopCard room={data} signedIn={Boolean(model.buyer)} />

      {data.lineup.length ? (
        <section aria-labelledby="ended-lineup">
          <h2 id="ended-lineup" className="mb-3 text-[20px] font-bold">
            The lineup
          </h2>
          <LineupGrid items={data.lineup} ended />
        </section>
      ) : null}
    </div>
  );
}
