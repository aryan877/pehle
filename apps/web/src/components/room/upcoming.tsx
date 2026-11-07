import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, CalendarClock, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { AlertsPrompt } from "~/components/alerts";
import { useSignIn } from "~/components/sign-in";
import { Avatar, Button, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap } from "~/lib/api";
import { mediaUrl } from "~/lib/format";
import { useServerNow } from "~/lib/useChat";

import { LineupGrid } from "./lineup";
import type { RoomModel } from "./model";
import { ShopCard, ShopLink } from "./shop";

/** "Today at 7:40 pm", "Tomorrow at 11 am" or "Sat 22 Nov at 7:40 pm". */
export function whenText(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const time = at
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: at.getMinutes() ? "2-digit" : undefined })
    .replace(/\s?([ap])\.?m\.?/i, " $1m");
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(new Date(now))) / 86_400_000);
  if (diff === 0) return `Today at ${time}`;
  if (diff === 1) return `Tomorrow at ${time}`;
  return `${at.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "")} at ${time}`;
}

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86_400), h: Math.floor((s % 86_400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** The countdown to the drop, on the server's clock so every phone hits zero together. */
function Countdown({ until, clockDelta }: { until: string; clockDelta: number }) {
  const now = useServerNow(clockDelta, 1000);
  const left = new Date(until).getTime() - now;
  if (left <= 0) {
    return (
      <p className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[15px] font-bold text-accent" role="status">
        <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden /> Starting any minute. Stay on this page.
      </p>
    );
  }
  const p = parts(left);
  const cells = [...(p.d ? [{ v: p.d, l: p.d === 1 ? "day" : "days" }] : []), { v: p.h, l: "hours" }, { v: p.m, l: "min" }, { v: p.s, l: "sec" }];
  return (
    <div
      className="grid max-w-sm auto-cols-fr grid-flow-col gap-2"
      role="timer"
      aria-label={`Starts in ${p.d ? `${p.d} days ` : ""}${p.h} hours ${p.m} minutes`}
    >
      {cells.map((c) => (
        <div key={c.l} className="min-w-0 rounded-xl bg-surface-2 px-1 py-2 text-center">
          <p className="tabular font-display text-[30px] font-extrabold leading-none">{String(c.v).padStart(2, "0")}</p>
          <p className="mt-1 text-[12px] font-semibold text-muted">{c.l}</p>
        </div>
      ))}
    </div>
  );
}

function RemindButton({ model }: { model: RoomModel }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const signIn = useSignIn();
  const [turnedOn, setTurnedOn] = useState(false);
  const remind = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/rooms/{slug}/remind", { params: { path: { slug: model.slug } } })),
    onSuccess: (r) => {
      setTurnedOn(r.reminded);
      toast(r.reminded ? "We'll remind you when it starts." : "Reminder off.", r.reminded ? "success" : "info");
      void queryClient.invalidateQueries({ queryKey: keys.room(model.slug) });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const on = model.data.reminded;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          variant={on ? "secondary" : "primary"}
          loading={remind.isPending}
          aria-pressed={on}
          onClick={() =>
            model.buyer
              ? remind.mutate()
              : signIn({ title: "Sign in for a reminder", reason: `We'll tell you the moment ${model.data.shop.displayName} starts this drop.` })
          }
        >
          {on ? <BellRing className="size-4 text-accent" aria-hidden /> : <Bell className="size-4" aria-hidden />}
          {on ? "Reminder on" : "Remind me"}
        </Button>
        {model.data.reminders > 0 ? (
          <p className="text-[14px] text-fg-2">
            <b className="text-fg">{model.data.reminders.toLocaleString("en-IN")}</b> {model.data.reminders === 1 ? "person wants" : "people want"} a
            reminder
          </p>
        ) : null}
      </div>
      {on && (turnedOn || model.data.reminded) ? <AlertsPrompt title="Get an alert when it starts" body="Even if this tab is closed." /> : null}
    </div>
  );
}

/** Before the drop: a countdown, Remind me, the lineup and the shop. */
export function UpcomingRoom({ model }: { model: RoomModel }) {
  const { data } = model;
  const cover = mediaUrl(data.lineup[0]?.imagePath ?? data.shop.coverPath ?? data.shop.avatarPath);
  const free = data.lineup.length > 0 && data.lineup.every((i) => i.pricePaise === 0);
  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-6">
      <section className="overflow-hidden rounded-xl bg-surface shadow-surface md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="relative aspect-[4/3] bg-black md:aspect-auto md:min-h-[360px]">
          {cover ? (
            <>
              <img src={cover} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-2xl" aria-hidden />
              <img src={cover} alt="" className="relative size-full object-contain" />
            </>
          ) : null}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[12px] font-bold text-white backdrop-blur">
            <CalendarClock className="size-3.5" aria-hidden /> Upcoming drop
          </span>
        </div>
        <div className="space-y-4 p-4 sm:p-6">
          <ShopLink handle={data.shop.handle} className="flex items-center gap-2.5">
            <Avatar name={data.shop.displayName} src={mediaUrl(data.shop.avatarPath)} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">{data.shop.displayName}</span>
              {data.shop.city ? <span className="block text-[13px] text-muted">{data.shop.city}</span> : null}
            </span>
          </ShopLink>
          <div>
            <h1 className="text-balance font-display text-[28px] font-bold leading-tight sm:text-[32px]">{data.live.title}</h1>
            {data.live.description ? <p className="mt-1.5 text-[15px] text-fg-2">{data.live.description}</p> : null}
          </div>
          <div className="space-y-2">
            <p className="text-[15px] font-semibold">{data.live.scheduledFor ? whenText(data.live.scheduledFor) : "Starting soon"}</p>
            {data.live.scheduledFor ? <Countdown until={data.live.scheduledFor} clockDelta={model.clockDelta} /> : null}
          </div>
          <RemindButton model={model} />
          <p className="flex items-start gap-2 text-[13px] text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
            {free
              ? "When it starts, the first people to claim win. The server decides who was first, and anyone can check the order."
              : `When it starts, the first to claim gets ${data.shop.holdMinutes} minutes to pay. The server decides who was first, and anyone can check the order.`}
          </p>
        </div>
      </section>

      {data.lineup.length ? (
        <section aria-labelledby="lineup-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="lineup-title" className="text-[20px] font-bold">
              What's dropping
            </h2>
            <p className="text-[14px] text-muted">{data.lineup.length === 1 ? "1 item" : `${data.lineup.length} items`}</p>
          </div>
          <LineupGrid items={data.lineup} />
        </section>
      ) : null}

      <ShopCard room={data} signedIn={Boolean(model.buyer)} className={cx("md:max-w-xl")} />
    </div>
  );
}
