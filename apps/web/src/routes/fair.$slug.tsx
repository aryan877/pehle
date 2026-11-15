import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { ShopAvatar, linkButton } from "~/components/browse";
import { AppShell } from "~/components/shell";
import { Badge, CodeChip, cx } from "~/components/ui";
import { api, keys, unwrap, type FairnessLog } from "~/lib/api";

export const Route = createFileRoute("/fair/$slug")({
  component: Fairness,
});

type Entry = FairnessLog["queue"][number];
type Event = FairnessLog["events"][number];

const STATUS_TONE = {
  held: "held",
  paid: "held",
  waitlisted: "wait",
  expired: "muted",
  released: "muted",
  cancelled: "danger",
} as const;

const STATUS_LABEL: Record<string, string> = {
  held: "Holding",
  paid: "Bought",
  waitlisted: "In line",
  expired: "Didn't pay in time",
  released: "Gave it up",
  cancelled: "Cancelled",
};

const SOURCE: Record<string, string> = {
  chat: "Pehle chat",
  button: "Claim button",
  seller: "Added by the shop",
  youtube: "YouTube chat",
};

const VIA: Record<string, string> = {
  gateway: "Verified by Razorpay",
  seller_confirmed: "Confirmed by the shop",
  free: "Free, won on the spot",
};

/** "2:40:00.306 PM": milliseconds matter when claims arrive together. */
function preciseTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${hour}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${h < 12 ? "AM" : "PM"}`;
}

function str(data: unknown, key: string): string | undefined {
  const v = (data as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : undefined;
}
function num(data: unknown, key: string): number | undefined {
  const v = (data as Record<string, unknown> | null)?.[key];
  return typeof v === "number" ? v : undefined;
}

/** Join events to the line: item codes come from drop events, buyer names from (code, position). */
function useLedger(log: FairnessLog | undefined) {
  return useMemo(() => {
    const codeOf = new Map<string, string>();
    const claimOf = new Map<string, { itemId: string; position: number }>();
    const viaOf = new Map<string, string>();
    for (const e of log?.events ?? []) {
      if (e.kind === "item.dropped" && e.itemId) {
        const code = str(e.data, "code");
        if (code) codeOf.set(e.itemId, code);
      }
      const position = num(e.data, "position");
      if (e.claimId && e.itemId && position != null && !claimOf.has(e.claimId)) claimOf.set(e.claimId, { itemId: e.itemId, position });
    }
    const entryAt = new Map<string, Entry>();
    for (const q of log?.queue ?? []) entryAt.set(`${q.itemCode}#${q.position}`, q);
    const who = (e: Event): { code: string; position?: number; name?: string } => {
      const claim = e.claimId ? claimOf.get(e.claimId) : undefined;
      const itemId = e.itemId ?? claim?.itemId;
      const code = (itemId && codeOf.get(itemId)) ?? str(e.data, "code") ?? "Item";
      const position = num(e.data, "position") ?? claim?.position;
      const name = position != null ? entryAt.get(`${code}#${position}`)?.buyerName : undefined;
      return { code, position, name };
    };
    for (const e of log?.events ?? []) {
      if (e.kind !== "order.paid") continue;
      const w = who(e);
      const via = str(e.data, "via");
      if (w.position != null && via) viaOf.set(`${w.code}#${w.position}`, via);
    }
    return { who, viaOf };
  }, [log]);
}

function sentence(e: Event, w: { code: string; position?: number; name?: string }): string {
  const name = w.name ?? "A buyer";
  const pos = w.position != null ? `#${w.position}` : "";
  const source = SOURCE[str(e.data, "source") ?? ""]?.toLowerCase();
  switch (e.kind) {
    case "item.dropped":
      return `${w.code} opened for claims`;
    case "item.closed":
      return `${w.code} closed for claims`;
    case "claim.held":
      return `${name} claimed ${w.code}${source ? ` with the ${source}` : ""}: ${pos}, got the hold`;
    case "claim.waitlisted":
      return `${name} claimed ${w.code}${source ? ` with the ${source}` : ""}: ${pos} in line`;
    case "claim.promoted":
      return `${w.code} passed to ${name}, next in line (${pos})`;
    case "claim.released":
      return `${name} gave up ${w.code}`;
    case "hold.expired":
      return `${name}'s hold on ${w.code} ran out unpaid`;
    case "order.paid": {
      const via = str(e.data, "via");
      if (via === "free") return `${name} won ${w.code}, free`;
      return `${name} paid for ${w.code}. ${VIA[via ?? ""] ?? "Paid"}`;
    }
    case "order.cancelled":
      return `The shop cancelled ${name}'s order for ${w.code}`;
    default:
      return e.kind;
  }
}

const KIND_DOT: Record<string, string> = {
  "item.dropped": "bg-info",
  "item.closed": "bg-muted",
  "claim.held": "bg-good",
  "claim.waitlisted": "bg-gold",
  "claim.promoted": "bg-good",
  "claim.released": "bg-muted",
  "hold.expired": "bg-accent",
  "order.paid": "bg-good",
  "order.cancelled": "bg-accent",
};

function Fairness() {
  const { slug } = Route.useParams();
  const log = useQuery({
    queryKey: keys.fairness(slug),
    queryFn: () => unwrap(api.GET("/api/v1/rooms/{slug}/fairness", { params: { path: { slug }, query: {} } })),
    refetchInterval: 5_000,
  });
  const ledger = useLedger(log.data);
  const [showAll, setShowAll] = useState(false);

  const byItem = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of log.data?.queue ?? []) {
      const list = groups.get(entry.itemCode) ?? [];
      list.push(entry);
      groups.set(entry.itemCode, list);
    }
    return [...groups.entries()].map(([code, list]) => [code, list.slice().sort((a, b) => a.position - b.position)] as const);
  }, [log.data]);

  if (log.isPending) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl space-y-4" role="status" aria-label="Loading">
          <div className="h-5 w-32 animate-pulse rounded bg-surface-2" />
          <div className="h-10 w-64 animate-pulse rounded bg-surface-2" />
          <div className="h-24 animate-pulse rounded-xl bg-surface" />
          <div className="h-56 animate-pulse rounded-xl bg-surface" />
        </div>
      </AppShell>
    );
  }
  if (!log.data) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
          <p className="font-display text-[28px] font-bold">Drop not found</p>
          <p className="text-fg-2">This fairness log link may be wrong.</p>
          <Link to="/" className={linkButton("secondary")}>
            Browse drops
          </Link>
        </div>
      </AppShell>
    );
  }
  const { shop, live, events, queue } = log.data;
  const promoted = events.filter((e) => e.kind === "claim.promoted").length;
  const paid = queue.filter((q) => q.status === "paid").length;
  const shown = showAll ? events : events.slice(-40);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6 pb-6">
        <Link to="/l/$slug" params={{ slug }} className="inline-flex items-center gap-1.5 rounded text-[14px] font-semibold text-fg-2 hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Back to the live
        </Link>

        <header className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-good-soft text-good">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-[30px] font-bold leading-tight">Who claimed first</h1>
            <p className="mt-1 text-[15px] text-fg">{live.title}</p>
            <Link to="/s/$handle" params={{ handle: shop.handle }} className="mt-1 inline-flex items-center gap-2 rounded text-[14px] text-fg-2 hover:text-fg hover:underline">
              <ShopAvatar name={shop.displayName} path={shop.avatarPath} size={20} />
              {shop.city ? `${shop.displayName}, ${shop.city}` : shop.displayName}
            </Link>
          </div>
          <Badge tone={live.status === "live" ? "live" : "muted"} className="ml-auto shrink-0">
            {live.status === "live" ? "Live" : live.status === "ended" ? "Ended" : "Not started"}
          </Badge>
        </header>

        <div className="rounded-xl bg-surface p-4 shadow-surface">
          <p className="flex items-start gap-2 text-[15px] text-fg">
            <Lock className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
            Pehle's server puts every claim in line in the order it arrives, before anyone sees it in chat. Positions are given one at a
            time under a database lock, in the same transaction that records the decision. The shop cannot reorder them.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Num label="claims" value={queue.length} />
            <Num label="pieces dropped" value={events.filter((e) => e.kind === "item.dropped").length} />
            <Num label="handed to the next buyer" value={promoted} />
            <Num label="bought" value={paid} />
          </dl>
        </div>

        <section aria-labelledby="line">
          <h2 id="line" className="text-[20px] font-bold">
            The line for each piece
          </h2>
          {byItem.length === 0 ? (
            <p className="mt-2 rounded-xl bg-surface px-4 py-8 text-center text-[15px] text-fg-2 shadow-surface">No claims yet.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {byItem.map(([code, entries]) => (
                <div key={code} className="overflow-hidden rounded-xl bg-surface shadow-surface">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                    <CodeChip code={code} />
                    <p className="font-semibold">{entries.length === 1 ? "1 claim" : `${entries.length} claims`}</p>
                  </div>
                  <ol className="divide-y divide-line">
                    {entries.map((e) => {
                      const via = e.status === "paid" ? ledger.viaOf.get(`${code}#${e.position}`) : undefined;
                      return (
                        <li key={`${code}-${e.position}`} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="tabular w-10 shrink-0 font-display text-[18px] font-bold text-fg-2">#{e.position}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{e.buyerName}</p>
                            <p className="truncate text-[13px] text-fg-2">
                              <span className="tabular font-mono text-[12px]">{preciseTime(e.nexconnReceivedAt ?? e.decidedAt)}</span>
                              {`, ${SOURCE[e.source] ?? e.source}`}
                              {via ? `. ${VIA[via] ?? via}` : ""}
                            </p>
                          </div>
                          <Badge tone={STATUS_TONE[e.status as keyof typeof STATUS_TONE] ?? "neutral"}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>

        {events.length ? (
          <section aria-labelledby="decisions">
            <div className="flex items-end justify-between gap-3">
              <h2 id="decisions" className="text-[20px] font-bold">
                Every decision, in order
              </h2>
              {events.length > 40 ? (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded text-[14px] font-semibold text-info hover:underline">
                  {showAll ? "Show latest 40" : `Show all ${events.length}`}
                </button>
              ) : null}
            </div>
            <ol className="mt-2 overflow-hidden rounded-xl bg-surface py-2 shadow-surface">
              {shown.map((e) => (
                <li key={e.id} className="relative flex gap-3 px-4 py-1.5">
                  <span className={cx("mt-[7px] size-2 shrink-0 rounded-full", KIND_DOT[e.kind] ?? "bg-muted")} aria-hidden />
                  <div className="min-w-0 flex-1 sm:flex sm:gap-3">
                    <span className="tabular block shrink-0 font-mono text-[12px] leading-6 text-fg-2 sm:w-[118px]">{preciseTime(e.at)}</span>
                    <span className="block text-[14px] leading-6 text-fg">{sentence(e, ledger.who(e))}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <p className="text-center text-[13px] text-fg-2">
          Times are when each claim reached Pehle. Message IDs and what people typed stay private.
        </p>
      </div>
    </AppShell>
  );
}

function Num({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-lg bg-surface-2 px-3 py-2">
      <dt className="text-[13px] leading-snug text-fg-2">{label}</dt>
      <dd className="tabular font-display text-[22px] font-bold leading-7">{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}
