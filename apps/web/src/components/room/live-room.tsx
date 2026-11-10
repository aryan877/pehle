import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronUp, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button, CodeChip, Sheet, cx, errorMessage, useCountdown, useToast } from "~/components/ui";
import { api, unwrap } from "~/lib/api";
import { clock, mediaUrl, streamHost } from "~/lib/format";

import { ChatColumn, Composer, PhoneChat } from "./chat-panel";
import { DesktopTopBar, InfoBar, PhoneHeader } from "./chrome";
import { ClaimButton, DropPanel, LapsedNotice, MyStatus, OtherHolds, QueueStrip, StockBar, claimRule, stockText, waitText } from "./claim";
import { DemoCoach } from "./demo-coach";
import { UpNext } from "./lineup";
import { myClaimFor, type RoomModel } from "./model";
import { ClubAction, MessageShopButton, priceLabel } from "./shop";
import { Gallery, DesktopStage, PhoneStage } from "./stage";

/** Desktop: Twitch layout. Stream or item photos on the left, the drop under it, chat on the right. */
export function DesktopLiveRoom({ model }: { model: RoomModel }) {
  const streamUrl = model.snapshot.streamUrl ?? model.data.live.streamUrl;
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <DesktopTopBar model={model} />
      <div className="flex min-h-0 flex-1">
        <main className="scrollbar-thin relative min-w-0 flex-1 overflow-y-auto">
          <DesktopStage model={model} />
          <InfoBar model={model} />
          <div className="mx-auto max-w-5xl space-y-5 px-6 pb-10">
            <DropPanel model={model} />
            <UpNext model={model} />
            {streamHost(streamUrl) === "youtube" && model.buyer ? <YoutubeLink slug={model.slug} connected={model.data.live.youtubeChat} /> : null}
            <FairnessLink slug={model.slug} claims={model.snapshot.claims} />
          </div>
        </main>
        <ChatColumn model={model} />
      </div>
      {model.demo ? <DemoCoach model={model} className="fixed left-6 top-[72px] z-30 w-[380px]" /> : null}
    </div>
  );
}

/** Phones: Whatnot layout. Full-bleed stage, chat floating over it, the item and a big Claim button. */
export function PhoneLiveRoom({ model }: { model: RoomModel }) {
  const [details, setDetails] = useState(false);
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <PhoneStage model={model} />
      <PhoneHeader model={model} />
      {model.demo ? (
        <div className="absolute inset-x-3 top-[calc(max(env(safe-area-inset-top),0.75rem)+3.5rem)] z-30 flex justify-end">
          <DemoCoach model={model} className="relative w-full" />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[78dvh] flex-col gap-2 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-20">
        <PhoneChat model={model} className={cx("h-[26dvh] min-h-24", model.demo && "h-[18dvh]")} />
        <OtherHolds model={model} exceptItemId={model.pinned?.id} glass />
        <PhoneDropCard model={model} onDetails={() => setDetails(true)} />
        <Composer model={model} glass />
      </div>
      <Sheet open={details} onClose={() => setDetails(false)} title={model.pinned ? `${model.pinned.code}, up for claims` : "This drop"}>
        <DetailsSheet model={model} />
      </Sheet>
    </div>
  );
}

function PhoneDropCard({ model, onDetails }: { model: RoomModel; onDetails: () => void }) {
  const item = model.pinned;
  if (!item) {
    return (
      <button onClick={onDetails} className="flex items-center gap-3 rounded-2xl bg-black/55 p-3 text-left ring-1 ring-white/10 backdrop-blur-md">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-white">Next item coming up</span>
          <span className="block text-[13px] text-white/70">First to claim gets {model.data.shop.holdMinutes} minutes to pay.</span>
        </span>
        <ChevronUp className="size-5 text-white/70" aria-hidden />
      </button>
    );
  }
  const mine = myClaimFor(model, item.id);
  const lapsed = !mine ? model.myClaims.find((c) => c.itemId === item.id && (c.status === "expired" || c.status === "released")) : undefined;
  const thumb = mediaUrl(item.photos[0]);
  return (
    <section className="rounded-2xl bg-black/60 p-3 ring-1 ring-white/10 backdrop-blur-md" aria-label="Up for claims">
      <button onClick={onDetails} className="flex w-full items-center gap-3 text-left" aria-label={`${item.title}. Details and what's next`}>
        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-3">
          {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : null}
          <CodeChip code={item.code} className="absolute bottom-0.5 left-0.5 px-1 text-[10px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-white">{item.title}</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5">
            <span className={cx("tabular font-display text-[20px] font-extrabold leading-tight", item.free ? "text-good" : "text-gold")}>
              {priceLabel(item.pricePaise)}
            </span>
            <span className="text-[13px] font-semibold text-white/80">{stockText(item)}</span>
          </span>
          <span className="mt-1 block">
            <StockBar item={item} glass />
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {item.waitlist ? (
            <span className="tabular rounded-full bg-gold px-2 text-[12px] font-bold leading-5 text-canvas">{item.waitlist} in line</span>
          ) : null}
          <ChevronUp className="size-5 text-white/60" aria-hidden />
        </span>
      </button>
      <div className="mt-2.5 space-y-1.5">
        {mine ? (
          <MyStatus model={model} entry={mine} item={item} glass />
        ) : (
          <>
            {lapsed ? (
              <div className="text-white/80 [&_p]:text-white/80">
                <LapsedNotice entry={lapsed} />
              </div>
            ) : null}
            <ClaimButton model={model} item={item} />
            <p id={`rule-${item.code}`} className="text-center text-[12px] text-white/65">
              {claimRule(item, model.data.shop.holdMinutes)}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function DetailsSheet({ model }: { model: RoomModel }) {
  const item = model.pinned;
  const streamUrl = model.snapshot.streamUrl ?? model.data.live.streamUrl;
  return (
    <div className="space-y-4">
      {item ? (
        <>
          {item.photos.length ? (
            <Gallery photos={item.photos} alt={item.title} variant="viewer" className="-mx-5 h-72 sm:mx-0 sm:rounded-xl" />
          ) : null}
          <div>
            <p className="text-[17px] font-bold leading-snug">{item.title}</p>
            <p className={cx("tabular mt-1 font-display text-[28px] font-extrabold", item.free ? "text-good" : "text-fg")}>
              {priceLabel(item.pricePaise)}
            </p>
            {item.description ? <p className="mt-1 text-[14px] text-fg-2">{item.description}</p> : null}
            <div className="mt-3 space-y-1.5">
              <StockBar item={item} />
              <p className="flex flex-wrap gap-x-3 text-[13px]">
                <b>{stockText(item)}</b>
                <span className={item.waitlist ? "font-semibold text-gold" : "text-muted"}>{waitText(item)}</span>
              </p>
            </div>
          </div>
          <div className="-mx-5 border-y border-line">
            <QueueStrip model={model} item={item} />
          </div>
        </>
      ) : null}
      <UpNext model={model} />
      {streamHost(streamUrl) === "youtube" && model.buyer ? <YoutubeLink slug={model.slug} connected={model.data.live.youtubeChat} /> : null}
      <div className="flex flex-wrap gap-2">
        <ClubAction room={model.data} signedIn={Boolean(model.buyer)} size="md" withAlerts />
        <MessageShopButton handle={model.data.shop.handle} />
      </div>
      <FairnessLink slug={model.slug} claims={model.snapshot.claims} />
    </div>
  );
}

function FairnessLink({ slug, claims }: { slug: string; claims: number }) {
  return (
    <Link
      to="/fair/$slug"
      params={{ slug }}
      className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-[14px] text-fg-2 shadow-surface transition hover:bg-surface-2 hover:text-fg"
    >
      <ShieldCheck className="size-5 shrink-0 text-good" aria-hidden />
      <span className="flex-1">
        <b className="text-fg">First claim wins, decided by the server.</b> See every decision
        {claims ? ` (${claims.toLocaleString("en-IN")} so far)` : ""}.
      </span>
      <ArrowRight className="size-4 shrink-0" aria-hidden />
    </Link>
  );
}

/** Lets a signed-in buyer claim by commenting in the YouTube chat they are already watching. */
function YoutubeLink({ slug, connected }: { slug: string; connected: boolean }) {
  const toast = useToast();
  const code = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/rooms/{slug}/youtube-code", { params: { path: { slug } } })),
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const left = useCountdown(code.data?.expiresAt);
  if (!connected) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 shadow-surface">
      <span className="inline-flex h-6 shrink-0 items-center rounded bg-[#ff0033] px-1.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
        YouTube
      </span>
      {code.data && left > 0 ? (
        <p className="min-w-0 flex-1 text-[13px] text-fg-2">
          Type <b className="rounded bg-canvas px-1.5 py-0.5 font-mono text-fg">pehle {code.data.code}</b> in the YouTube chat within{" "}
          <span className="tabular font-mono">{clock(left)}</span>. Then <b className="text-fg">mine</b> there counts as you.
        </p>
      ) : (
        <p className="min-w-0 flex-1 text-[13px] text-fg-2">
          {code.data?.linkedAs ? (
            <>
              Linked as <b className="text-fg">{code.data.linkedAs}</b>. Typing <b className="text-fg">mine</b> in YouTube chat claims here.
            </>
          ) : (
            <>
              Commenting on YouTube? Link your name and <b className="text-fg">mine</b> in the YouTube chat claims for you here.
            </>
          )}
        </p>
      )}
      {!code.data || left === 0 ? (
        <Button size="sm" variant="secondary" loading={code.isPending} onClick={() => code.mutate()}>
          {code.data?.linkedAs ? "Relink" : "Link"}
        </Button>
      ) : null}
    </div>
  );
}
