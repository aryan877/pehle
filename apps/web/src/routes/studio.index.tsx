import { Link, createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, BarChart3, Bot, CalendarClock, Check, ChevronRight, Package, Plus, Radio, Wallet } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { CopyButton, PageHeader, SectionTitle, Stat } from "~/components/studio/bits";
import { groupLives, useApprovals, useItems, useLineup, useLives, useOpenOrders, useReport, useStats } from "~/components/studio/queries";
import { GoLiveButton, roomLink, shareMessage } from "~/components/studio/share-kit";
import { useShop } from "~/components/studio/shop-context";
import { countdownText, dropTime } from "~/components/studio/time";
import { Badge, Button, LiveDot, Spinner, WhatsAppIcon, cx, useCountdown, useToast } from "~/components/ui";
import type { Live } from "~/lib/api";
import { rupees, timeAgo } from "~/lib/format";

export const Route = createFileRoute("/studio/")({
  component: Dashboard,
});

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Dashboard() {
  const { shop, staff } = useShop();
  const lives = useLives(shop.id);
  const stats = useStats(shop.id);
  const orders = useOpenOrders(shop.id);
  const approvals = useApprovals(shop.id);
  const items = useItems(shop.id);
  const { live, upcoming, past } = groupLives(lives.data);
  const running = live[0];
  const next = upcoming[0];
  const last = past[0];

  const reported = orders.data?.filter((o) => o.status === "payment_reported") ?? [];
  const awaiting = orders.data?.filter((o) => o.status === "awaiting_payment") ?? [];
  const pendingApprovals = approvals.data ?? [];
  const approvalLive = pendingApprovals.find((a) => a.liveId)?.liveId ?? running?.id;
  const noItems = items.data?.length === 0;
  const noPayments = !shop.upiVpa;

  const attention: ReactNode[] = [];
  if (running) {
    attention.push(
      <AttentionRow
        key="live"
        icon={Radio}
        tone="live"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="live">
              <LiveDot /> Live
            </Badge>
            {running.title}
          </span>
        }
        text={`Started ${running.startedAt ? timeAgo(running.startedAt) : "just now"}. Open the next item from the console.`}
        action={
          <Link to="/studio/live/$liveId" params={{ liveId: running.id }}>
            <Button>Resume console</Button>
          </Link>
        }
      />,
    );
  }
  if (reported.length) {
    attention.push(
      <AttentionRow
        key="pay"
        icon={BadgeCheck}
        tone="accent"
        title={`${reported.length} ${reported.length === 1 ? "payment" : "payments"} to confirm`}
        text={`${reported
          .slice(0, 3)
          .map((o) => `${o.buyerName} for ${o.itemCode}`)
          .join(", ")}${reported.length > 3 ? ` and ${reported.length - 3} more` : ""}. Check your UPI app, then confirm.`}
        action={
          <Link to="/studio/orders">
            <Button>Review</Button>
          </Link>
        }
      />,
    );
  }
  if (pendingApprovals.length && approvalLive) {
    attention.push(
      <AttentionRow
        key="approvals"
        icon={Bot}
        tone="gold"
        title={`${pendingApprovals.length} ${pendingApprovals.length === 1 ? "question needs" : "questions need"} your answer`}
        text="The co-host asks you before promising a discount, cash on delivery or more time."
        action={
          <Link to="/studio/live/$liveId" params={{ liveId: approvalLive }}>
            <Button variant="secondary">Answer</Button>
          </Link>
        }
      />,
    );
  }
  if (noItems) {
    attention.push(
      <AttentionRow
        key="items"
        icon={Package}
        title="Add your first item"
        text="A photo, a price and a short code like S1 that you say on stream."
        action={
          <Link to="/studio/catalog/new">
            <Button variant="secondary">Add item</Button>
          </Link>
        }
      />,
    );
  }
  if (noPayments && !shop.isDemo) {
    attention.push(
      <AttentionRow
        key="upi"
        icon={Wallet}
        title="Add your UPI ID"
        text="Winners pay you directly. Without it, they can't check out."
        action={
          <Link to="/studio/settings">
            <Button variant="secondary">Add UPI</Button>
          </Link>
        }
      />,
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`${greeting()}, ${staff.displayName.split(" ")[0]}`} subtitle={[shop.displayName, shop.city].filter(Boolean).join(", ")} />

      <section>
        <SectionTitle>Needs your attention</SectionTitle>
        {lives.isPending || orders.isPending ? (
          <div className="flex justify-center rounded-xl bg-surface py-8 shadow-surface">
            <Spinner />
          </div>
        ) : attention.length ? (
          <ul className="overflow-hidden rounded-xl bg-surface shadow-surface">{attention}</ul>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-4 shadow-surface">
            <span className="flex size-9 items-center justify-center rounded-full bg-good-soft text-good">
              <Check className="size-5" />
            </span>
            <p className="text-fg-2">
              You're all caught up.
              {awaiting.length ? ` ${awaiting.length} ${awaiting.length === 1 ? "buyer is" : "buyers are"} still paying.` : ""}
            </p>
          </div>
        )}
      </section>

      {next ? <NextDrop live={next} more={upcoming.length - 1} /> : !running && !lives.isPending ? <FirstDrop hasItems={!noItems} /> : null}

      <section>
        <SectionTitle action={<span className="text-[13px] text-muted">All time</span>}>Your numbers</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat label="Money collected" value={stats.data ? rupees(stats.data.revenuePaise) : "0"} hint="Confirmed payments" tone="text-good" />
          <Stat label="Paid orders" value={stats.data?.ordersPaid ?? 0} hint={stats.data?.waitlistPromotions ? `${stats.data.waitlistPromotions} passed to the next in line` : "Across all drops"} />
          <Stat label="Claims" value={stats.data?.claims ?? 0} hint={stats.data ? `From ${stats.data.buyersWhoClaimed} ${stats.data.buyersWhoClaimed === 1 ? "buyer" : "buyers"}` : undefined} />
          <Stat label="Club" value={stats.data?.followers ?? 0} hint="Hear first when you go live" />
        </div>
      </section>

      {last ? <LastDrop live={last} /> : null}
    </div>
  );
}

const tones = {
  live: "bg-live text-white",
  accent: "bg-accent text-white",
  gold: "bg-gold-soft text-gold",
  neutral: "bg-surface-3 text-fg",
};

function AttentionRow({
  icon: Icon,
  title,
  text,
  action,
  tone = "neutral",
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  text: ReactNode;
  action: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:flex-nowrap sm:px-4">
      <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-full", tones[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="w-[calc(100%-52px)] min-w-0 sm:w-auto sm:flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="text-[14px] text-fg-2">{text}</p>
      </div>
      <div className="ml-[52px] shrink-0 sm:ml-0">{action}</div>
    </li>
  );
}

function NextDrop({ live, more }: { live: Live; more: number }) {
  const { shop } = useShop();
  const toast = useToast();
  const left = useCountdown(live.scheduledFor);
  const lineup = useLineup(live.id);
  const url = roomLink(live.slug);
  const message = shareMessage({ shopName: shop.displayName, live, url, itemCount: lineup.data?.length ?? 0 });
  return (
    <section>
      <SectionTitle
        action={
          more > 0 ? (
            <Link to="/studio/drops" className="text-[14px] font-semibold text-fg-2 hover:text-fg">
              {more} more upcoming
            </Link>
          ) : null
        }
      >
        Next drop
      </SectionTitle>
      <div className="grid gap-4 rounded-xl bg-surface p-4 shadow-surface sm:p-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-gold">
            <CalendarClock className="size-4" /> {live.scheduledFor ? dropTime(live.scheduledFor) : "No start time yet"}
          </p>
          <p className="mt-1 line-clamp-2 font-display text-[24px] font-bold leading-tight">{live.title}</p>
          {live.scheduledFor ? (
            <p className="tabular mt-1 text-[15px] text-fg-2">{left > 0 ? `Starts in ${countdownText(left)}` : "Starting now. Go live when your stream is up."}</p>
          ) : null}
          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 py-1.5 pl-3 pr-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-info">{url.replace(/^https?:\/\//, "")}</span>
            <CopyButton text={url} label="Copy link" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#1fa855] px-3.5 text-[14px] font-semibold text-white hover:brightness-110"
            >
              <WhatsAppIcon className="size-[18px]" /> WhatsApp
            </a>
            <Link to="/studio/drops/$liveId" params={{ liveId: live.id }}>
              <Button variant="secondary">Share kit and lineup</Button>
            </Link>
          </div>
        </div>
        <div className="flex flex-col justify-end">
          <GoLiveButton live={live} onError={(m) => toast(m, "error")} />
        </div>
      </div>
    </section>
  );
}

function FirstDrop({ hasItems }: { hasItems: boolean }) {
  const steps = [
    { done: hasItems, title: "Add items", text: "Photo, price and a code", to: "/studio/catalog/new" },
    { done: false, title: "Create a drop", text: "Time, stream link and lineup", to: "/studio/drops/new" },
    { done: false, title: "Share the link", text: "WhatsApp, Instagram story, QR", to: "/studio/drops/new" },
    { done: false, title: "Go live", text: "Open items one at a time", to: "/studio/drops/new" },
  ];
  return (
    <section>
      <SectionTitle>Run your first drop</SectionTitle>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link to={s.to} className="flex h-full items-center gap-3 rounded-xl bg-surface p-3 shadow-surface hover:bg-surface-2">
              <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold", s.done ? "bg-good text-white" : "bg-surface-3")}>
                {s.done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{s.title}</span>
                <span className="block truncate text-[13px] text-fg-2">{s.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <Link to="/studio/drops/new" className="mt-3 inline-block">
        <Button>
          <Plus className="size-4" /> Create drop
        </Button>
      </Link>
    </section>
  );
}

function LastDrop({ live }: { live: Live }) {
  const report = useReport(live.id);
  const r = report.data;
  return (
    <section>
      <SectionTitle>Last drop</SectionTitle>
      <Link to="/studio/drops/$liveId/report" params={{ liveId: live.id }} className="block rounded-xl bg-surface p-4 shadow-surface transition hover:bg-surface-2 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3">
            <BarChart3 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{live.title}</p>
            <p className="text-[13px] text-fg-2">Ended {live.endedAt ? timeAgo(live.endedAt) : ""}</p>
          </div>
          <span className="hidden items-center gap-1 text-[14px] font-semibold text-fg-2 sm:inline-flex">
            See report <ChevronRight className="size-4" />
          </span>
        </div>
        {r ? (
          <dl className="tabular mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Sold" value={`${r.unitsSold} of ${r.unitsOffered}`} />
            <Mini label="Collected" value={rupees(r.revenuePaise)} />
            <Mini label="Non-payers replaced" value={r.nonPayersReplaced} />
            <Mini label="Still waiting" value={r.stillWaiting} tone={r.stillWaiting ? "text-gold" : undefined} />
          </dl>
        ) : report.isPending ? (
          <div className="mt-4">
            <Spinner />
          </div>
        ) : null}
      </Link>
    </section>
  );
}

function Mini({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[13px] text-fg-2">{label}</dt>
      <dd className={cx("truncate font-display text-[22px] font-bold", tone)}>{value}</dd>
    </div>
  );
}
