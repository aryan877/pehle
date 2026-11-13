// The judges' coach for the demo drop (`?demo=1`): it walks through one race against scripted
// rivals, reacting to what the server decided, so the fairness of the line is visible in seconds.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Flag, MousePointerClick, PartyPopper, RotateCcw, TimerOff, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type Schemas } from "~/lib/api";
import { clock } from "~/lib/format";
import { useServerNow } from "~/lib/useChat";

import { aheadOf, useFairnessQueue } from "./claim";
import { myClaimFor, useServerCountdown, type RoomModel } from "./model";

type FairEntry = Schemas["FairEntry"];

const key = (e: FairEntry) => `${e.itemCode}-${e.position}`;

/** The server treats a race as running for two minutes after its piece drops. */
const RACE_MS = 120_000;
/** Rivals claim in two seconds, then lapse every eight seconds at most eight times. */
const QUIET_MS = 70_000;

export function DemoCoach({ model, className }: { model: RoomModel; className?: string }) {
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const log = useFairnessQueue(model);
  const item = model.pinned && model.pinned.status === "open" ? model.pinned : null;
  const mine = item ? myClaimFor(model, item.id) : undefined;
  const lapsedMine = item ? model.myClaims.find((c) => c.itemId === item.id && c.status === "expired") : undefined;
  const entries = (log.data?.queue ?? []).filter((e) => e.itemCode === item?.code);
  const holdLeft = useServerCountdown(mine?.status === "held" ? mine.holdExpiresAt : null, model.clockDelta);

  // Spot holds that lapse while we watch, so the coach can explain the line moving.
  const seen = useRef<{ code: string; keys: Set<string> } | null>(null);
  const [lapse, setLapse] = useState<{ name: string; at: number } | null>(null);
  useEffect(() => {
    if (!item || !log.data) return;
    const expired = log.data.queue.filter((e) => e.itemCode === item.code && e.status === "expired");
    if (!seen.current || seen.current.code !== item.code) {
      seen.current = { code: item.code, keys: new Set(expired.map(key)) };
      return;
    }
    const fresh = expired.filter((e) => !seen.current!.keys.has(key(e)));
    for (const e of fresh) seen.current.keys.add(key(e));
    const latest = fresh.at(-1);
    if (latest && !model.mineKeys.has(key(latest))) setLapse({ name: latest.buyerName, at: Date.now() });
  }, [item, log.data, model.mineKeys]);
  useEffect(() => {
    if (!lapse) return;
    const id = window.setTimeout(() => setLapse(null), 5000);
    return () => window.clearTimeout(id);
  }, [lapse]);

  // How the visitor got the piece: first, or after the line moved.
  const wasWaiting = useRef(false);
  if (mine?.status === "waitlisted") wasWaiting.current = true;
  useEffect(() => {
    wasWaiting.current = false;
  }, [item?.code]);

  const race = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/demo/race")),
    onSuccess: async (r) => {
      setLapse(null);
      seen.current = null;
      wasWaiting.current = false;
      setOpen(true);
      if (r.slug !== model.slug) {
        await navigate({ to: "/l/$slug", params: { slug: r.slug }, search: { demo: 1 } });
      }
      await queryClient.invalidateQueries({ queryKey: keys.room(r.slug) });
      await queryClient.invalidateQueries({ queryKey: keys.fairness(r.slug) });
      toast(r.started ? `${r.itemCode} just dropped. Claim it!` : `A race for ${r.itemCode} is already running. Jump in!`, "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const rivals = entries.filter((e) => !model.mineKeys.has(key(e))).length;
  const ahead = mine ? aheadOf(log.data, mine) : null;

  // When this piece dropped: the drop event, or else the first claim on it (rivals claim within
  // about two seconds). Rivals stop lapsing after about a minute, and the server starts a fresh
  // race only once the current piece is two minutes old.
  const serverNow = useServerNow(model.clockDelta, 1000);
  const droppedAt = useMemo(() => {
    if (!item || !log.data) return null;
    const dropped = log.data.events.filter((e) => e.kind === "item.dropped" && e.itemId === item.id).at(-1);
    if (dropped) return new Date(dropped.at).getTime();
    const first = log.data.queue.filter((e) => e.itemCode === item.code).map((e) => new Date(e.decidedAt).getTime());
    return first.length ? Math.min(...first) - 1000 : null;
  }, [item, log.data]);
  const restartIn = droppedAt ? Math.max(0, droppedAt + RACE_MS - serverNow) : 0;
  const quiet = Boolean(item && droppedAt && serverNow - droppedAt > QUIET_MS && mine?.status !== "held" && mine?.status !== "paid");
  // Someone else paid for every piece: the line has nothing left to move.
  const allSold = Boolean(item && item.paid >= item.quantity && mine?.status !== "paid");
  const soldEntry = allSold ? entries.find((e) => e.status === "paid") : undefined;
  const soldTo = allSold ? (soldEntry?.buyerName ?? "Someone") : null;

  let step: { icon: ReactNode; tone: "accent" | "gold" | "good" | "muted"; title: string; body: ReactNode; action?: ReactNode; celebrate?: boolean };
  const start = (primary: boolean) => (
    <Button
      size={primary ? "md" : "sm"}
      variant={primary ? "primary" : "ghost"}
      loading={race.isPending}
      disabled={restartIn > 0}
      onClick={() => race.mutate()}
      className={primary ? undefined : "ml-auto"}
    >
      {primary ? <Flag className="size-4" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
      {restartIn > 0 ? (
        <>
          New race in <span className="tabular font-mono">{clock(restartIn)}</span>
        </>
      ) : model.myClaims.length ? (
        "Start another race"
      ) : (
        "Start a race"
      )}
    </Button>
  );
  let primaryStart = false;

  if (!item) {
    primaryStart = true;
    step = {
      icon: <Flag className="size-5" />,
      tone: "accent",
      title: lapsedMine || model.myClaims.length ? "That race is over" : "Ready when you are",
      body: "Start a race and four rival buyers will go for the same piece. Tap Claim as fast as you can.",
    };
  } else if (!mine && lapsedMine) {
    primaryStart = true;
    step = {
      icon: <TimerOff className="size-5" />,
      tone: "muted",
      title: "You didn't pay in time",
      body: "So it went to the next person in line. The same rule applies to everyone, and the fairness log shows it.",
    };
  } else if (soldTo && mine?.status !== "held") {
    primaryStart = true;
    step = {
      icon: <TimerOff className="size-5" />,
      tone: "muted",
      title: `${soldEntry && model.mineKeys.has(key(soldEntry)) ? "You" : soldTo} paid in time, so ${item.code} is sold`,
      body: mine
        ? `You were #${mine.position}. The line only moves when someone ahead doesn't pay. Start a fresh race and claim first.`
        : "The line only moves when someone ahead doesn't pay. Start a fresh race and tap Claim the moment it drops.",
    };
  } else if (!mine && quiet) {
    primaryStart = true;
    step = {
      icon: <Flag className="size-5" />,
      tone: "muted",
      title: "This race has gone quiet",
      body: `The rivals for ${item.code} have stopped. Start a fresh race and tap Claim the moment it drops.`,
    };
  } else if (!mine) {
    step = {
      icon: <MousePointerClick className="size-5" />,
      tone: "accent",
      title: model.claim.pendingCode ? "Checking your place" : "Tap Claim as fast as you can",
      body: model.claim.pendingCode
        ? "The server is putting every claim in order."
        : rivals
          ? `${rivals} ${rivals === 1 ? "rival has" : "rivals have"} claimed already. You can still join the line.`
          : `Four rival buyers are racing you for ${item.code}. The server decides who was first.`,
    };
  } else if (mine.status === "waitlisted") {
    if (lapse) {
      step = {
        icon: <TimerOff className="size-5" />,
        tone: "gold",
        title: `${lapse.name} didn't pay in time. The line moves.`,
        body: ahead
          ? `You're #${mine.position}. ${ahead === 1 ? "One person is" : `${ahead} people are`} still ahead of you.`
          : "You're next. Watch it move to you.",
      };
    } else if (quiet) {
      primaryStart = true;
      step = {
        icon: <span className="tabular font-display text-[13px] font-extrabold">#{mine.position}</span>,
        tone: "gold",
        title: `You're #${mine.position} in line`,
        body: "The rivals in this race have stopped, so the line won't move again. Start a fresh race and claim first this time.",
      };
    } else {
      step = {
        icon: <span className="tabular font-display text-[13px] font-extrabold">#{mine.position}</span>,
        tone: "gold",
        title: `You're #${mine.position} in line`,
        body:
          ahead === 0
            ? "You're next. If the person holding it doesn't pay in time, it moves to you automatically."
            : `${ahead ?? "Some"} ${ahead === 1 ? "person is" : "people are"} ahead of you. The demo rivals never pay, so watch the line move.`,
      };
    }
  } else if (mine.status === "held") {
    const promoted = wasWaiting.current;
    step = {
      icon: <Trophy className="size-5" />,
      tone: "good",
      celebrate: true,
      title: promoted ? (lapse ? `${lapse.name} didn't pay. It moved to you!` : "It moved to you!") : "You got it first!",
      body: (
        <>
          It's yours, #{mine.position}. Pay within <b className="tabular font-mono text-fg">{clock(holdLeft)}</b> or it goes to the next person.
          Nothing is charged in the demo.
        </>
      ),
      action: mine.orderId ? (
        <Link
          to="/o/$orderId"
          params={{ orderId: mine.orderId }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-good px-4 text-[15px] font-bold text-canvas hover:brightness-110"
        >
          Go to checkout
        </Link>
      ) : undefined,
    };
  } else {
    primaryStart = true;
    step = {
      icon: <PartyPopper className="size-5" />,
      tone: "good",
      celebrate: true,
      title: "You bought it",
      body: "That's the whole loop: claim, a timed hold, pay, and the line moving on its own when someone doesn't pay.",
    };
  }
  const showSecondaryStart = !primaryStart && Boolean(mine);

  const toneClass = {
    accent: "bg-accent text-white",
    gold: "bg-gold text-canvas",
    good: "bg-good text-canvas",
    muted: "bg-surface-3 text-fg-2",
  }[step.tone];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-semibold text-fg ring-1 ring-white/10 backdrop-blur",
          className,
        )}
      >
        What's happening <ChevronUp className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <section
      className={cx("overflow-hidden rounded-2xl bg-black/70 px-3.5 py-3 shadow-lift ring-1 ring-white/10 backdrop-blur-md", className ?? "relative")}
      aria-live="polite"
      aria-label="Demo coach"
    >
      {step.celebrate ? <Burst key={`${mine?.claimId}-${mine?.status}`} /> : null}
      <div key={step.title} className="flex animate-rise items-start gap-3">
        <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", toneClass)} aria-hidden>
          {step.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug">{step.title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{step.body}</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="-m-1 shrink-0 rounded-md p-1 text-muted hover:bg-white/10 hover:text-fg"
          aria-label="Minimise"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      {step.action || primaryStart || showSecondaryStart ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-11">
          {step.action}
          {primaryStart ? start(true) : showSecondaryStart ? start(false) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A small confetti burst, skipped for people who prefer less motion. */
function Burst() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pieces = root.current?.querySelectorAll<HTMLSpanElement>("span") ?? [];
    pieces.forEach((el, i) => {
      const angle = (i / pieces.length) * Math.PI * 2;
      const distance = 70 + (i % 4) * 22;
      el.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 1 },
          { transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance - 20}px) scale(0.6)`, opacity: 0 },
        ],
        { duration: 900 + (i % 5) * 120, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
      );
    });
  }, []);
  const colours = ["#ff2d78", "#ffc233", "#3fbb46", "#5aa7ff", "#e2e5e9"];
  return (
    <div ref={root} className="pointer-events-none absolute left-9 top-14" aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <span key={i} className="absolute size-2 rounded-sm opacity-0" style={{ background: colours[i % colours.length] }} />
      ))}
    </div>
  );
}
