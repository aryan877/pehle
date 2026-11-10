import { Link, createFileRoute } from "@tanstack/react-router";
import { Radio, Share2, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader, SectionTitle } from "~/components/studio/bits";
import { RunAgainButton } from "~/components/studio/drop-editor";
import { useLives, useReport } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { shortDuration } from "~/components/studio/time";
import { Badge, Button, CodeChip, Empty, LiveDot, PageSpinner, cx, errorMessage } from "~/components/ui";
import type { DropReport } from "~/lib/api";
import { rupees, timeAgo } from "~/lib/format";

export const Route = createFileRoute("/studio/drops/$liveId/report")({
  component: ReportPage,
});

function ReportPage() {
  const { liveId } = Route.useParams();
  const { shop } = useShop();
  const lives = useLives(shop.id);
  const report = useReport(liveId);
  const live = lives.data?.find((l) => l.id === liveId);

  if (report.isPending || lives.isPending) return <PageSpinner />;
  if (report.isError || !report.data) {
    return (
      <Empty
        title="Couldn't load this report"
        action={
          <Link to="/studio/drops">
            <Button variant="secondary">Back to drops</Button>
          </Link>
        }
      >
        {report.error ? errorMessage(report.error) : null}
      </Empty>
    );
  }
  const r = report.data;
  const restock = r.items.filter((i) => i.waiting > 0).sort((a, b) => b.waiting - a.waiting);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: "/studio/drops", label: "Drops" }}
        title={live?.title ?? "Drop report"}
        subtitle={
          live?.status === "live" ? (
            <span className="inline-flex items-center gap-2">
              <Badge tone="live">
                <LiveDot /> Live
              </Badge>
              Numbers update as the drop runs.
            </span>
          ) : live?.endedAt ? (
            `Ended ${timeAgo(live.endedAt)}`
          ) : (
            "How the drop went"
          )
        }
        actions={
          live ? (
            <>
              {live.status === "live" ? (
                <Link to="/studio/live/$liveId" params={{ liveId: live.id }}>
                  <Button variant="secondary">
                    <Radio className="size-4" /> Console
                  </Button>
                </Link>
              ) : live.status === "draft" ? (
                <Link to="/studio/drops/$liveId" params={{ liveId: live.id }}>
                  <Button variant="secondary">
                    <Share2 className="size-4" /> Share kit
                  </Button>
                </Link>
              ) : null}
              <RunAgainButton live={live} />
            </>
          ) : null
        }
      />

      <BigNumbers report={r} />

      <p className="text-[14px] text-fg-2">
        {r.claims.toLocaleString("en-IN")} {r.claims === 1 ? "claim" : "claims"} from {r.claimants.toLocaleString("en-IN")}{" "}
        {r.claimants === 1 ? "person" : "people"} across {r.itemsDropped} {r.itemsDropped === 1 ? "item" : "items"}
        {r.viewersSignedIn ? `, with ${r.viewersSignedIn.toLocaleString("en-IN")} signed-in viewers` : ""}.
      </p>

      {restock.length ? (
        <section className="rounded-xl bg-gold-soft p-4 ring-1 ring-inset ring-gold/25">
          <p className="flex items-center gap-2 font-semibold text-gold">
            <TrendingUp className="size-5" /> Restock demand
          </p>
          <ul className="mt-2 space-y-1.5">
            {restock.map((i) => (
              <li key={i.itemId} className="flex flex-wrap items-center gap-2 text-[15px]">
                <CodeChip code={i.code} />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="font-semibold text-gold">
                  {i.waiting} still waiting
                </span>
                <Link to="/studio/catalog/$itemId" params={{ itemId: i.itemId }} className="text-[14px] font-semibold text-fg underline-offset-2 hover:underline">
                  Restock
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-fg-2">Raise the quantity, then run the drop again.</p>
        </section>
      ) : null}

      <section>
        <SectionTitle>Item by item</SectionTitle>
        {r.items.length === 0 ? (
          <Empty title="Nothing was claimed in this drop yet." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl bg-surface shadow-surface md:block">
              <table className="w-full text-left text-[14px]">
                <thead className="border-b border-line text-[13px] text-fg-2">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Item</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Sold</th>
                    <th className="px-3 py-2.5 text-right font-semibold">On hold</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Waiting</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Claims</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Sold out in</th>
                  </tr>
                </thead>
                <tbody className="tabular divide-y divide-line">
                  {r.items.map((i) => (
                    <tr key={i.itemId}>
                      <td className="px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <CodeChip code={i.code} />
                          <span className="truncate">{i.title}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold">
                        {i.sold} of {i.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-right">{i.held}</td>
                      <td className={cx("px-3 py-2.5 text-right", i.waiting && "font-semibold text-gold")}>{i.waiting}</td>
                      <td className="px-3 py-2.5 text-right">{i.claims}</td>
                      <td className="px-4 py-2.5 text-right">{i.sellOutSeconds === null || i.sellOutSeconds === undefined ? "Not sold out" : shortDuration(i.sellOutSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2 md:hidden">
              {r.items.map((i) => (
                <li key={i.itemId} className="rounded-xl bg-surface p-3 shadow-surface">
                  <div className="flex min-w-0 items-center gap-2">
                    <CodeChip code={i.code} />
                    <span className="truncate font-semibold">{i.title}</span>
                  </div>
                  <dl className="tabular mt-2 grid grid-cols-3 gap-2 text-[13px]">
                    <Cell label="Sold" value={`${i.sold} of ${i.quantity}`} />
                    <Cell label="Waiting" value={i.waiting} tone={i.waiting ? "text-gold" : undefined} />
                    <Cell label="Sold out in" value={i.sellOutSeconds === null || i.sellOutSeconds === undefined ? "Not yet" : shortDuration(i.sellOutSeconds)} />
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <dt className="text-fg-2">{label}</dt>
      <dd className={cx("font-semibold", tone)}>{value}</dd>
    </div>
  );
}

function BigNumbers({ report: r }: { report: DropReport }) {
  const pct = r.unitsOffered ? Math.round((r.unitsSold / r.unitsOffered) * 100) : 0;
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
      <Big
        label="Sold"
        value={
          <>
            {r.unitsSold}
            <span className="text-[20px] text-fg-2"> of {r.unitsOffered}</span>
          </>
        }
        hint={`${pct}% of what you offered`}
        bar={pct}
      />
      <Big label="Money collected" value={rupees(r.revenuePaise)} hint={r.paidViaGateway ? `${r.paidViaGateway} confirmed by Razorpay` : "Confirmed payments"} tone="text-good" />
      <Big label="Median sell-out time" value={shortDuration(r.medianSellOutSeconds)} hint="From opening an item to its last claim" />
      <Big label="Non-payers replaced" value={r.nonPayersReplaced} hint="Unpaid holds passed on automatically" />
      <Big label="Still waiting" value={r.stillWaiting} hint="People in line: your restock demand" tone={r.stillWaiting ? "text-gold" : undefined} />
      <Big label="New club members" value={r.newClubMembers} hint="Followed your shop during the drop" />
    </div>
  );
}

function Big({ label, value, hint, tone, bar }: { label: string; value: ReactNode; hint: string; tone?: string; bar?: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface p-3 shadow-surface sm:p-4">
      <p className="text-[13px] font-semibold text-fg-2">{label}</p>
      <p className={cx("tabular mt-1 truncate font-display text-[28px] font-bold leading-tight sm:text-[34px]", tone ?? "text-fg")}>{value}</p>
      {bar !== undefined ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-good" style={{ width: `${bar}%` }} />
        </div>
      ) : null}
      <p className="mt-1.5 text-[13px] text-muted">{hint}</p>
    </div>
  );
}
