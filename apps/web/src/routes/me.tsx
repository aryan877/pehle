import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Clock, LogOut, ShoppingBag, Users, Zap } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { ShopAvatar, WinnerNote, linkButton, place, priceLabel, useBrowse } from "~/components/browse";
import { AppShell, BrowseSidebar, PhotoTile, categoryLabel } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Avatar, Button, cx, useCountdown } from "~/components/ui";
import { api, keys, unwrap, type OrderView } from "~/lib/api";
import { clock, timeAgo } from "~/lib/format";
import { buyerOf, useSession, useSignOut } from "~/lib/session";

export const Route = createFileRoute("/me")({ component: Buying });

function Buying() {
  const session = useSession();
  const buyer = buyerOf(session.data);
  const me = session.data?.me;
  return (
    <AppShell sidebar={<BrowseSidebar />}>
      <div className="mx-auto max-w-[760px] space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-[28px] font-bold leading-tight">Buying</h1>
          {buyer ? <Account name={buyer.displayName} avatar={buyer.avatarUrl} demo={buyer.isDemo} /> : null}
        </div>
        {session.isPending ? (
          <ListSkeleton />
        ) : me?.kind === "staff" ? (
          <Notice title="You're signed in to your shop">
            Buying shows claims and orders for buyer accounts. Your shop's orders are in the studio.
            <div className="pt-3">
              <Link to="/studio/orders" className={linkButton("secondary")}>
                Open shop orders
              </Link>
            </div>
          </Notice>
        ) : buyer ? (
          <Orders />
        ) : (
          <SignedOut />
        )}
      </div>
    </AppShell>
  );
}

function Account({ name, avatar, demo }: { name: string; avatar?: string | null; demo: boolean }) {
  const signOut = useSignOut();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={name} src={avatar} size={32} />
      <div className="min-w-0 text-right sm:text-left">
        <p className="truncate text-[15px] font-semibold">{name}</p>
        {demo ? <p className="text-[12px] text-gold">Guest for the practice drop</p> : null}
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="ml-1 rounded-full p-2 text-fg-2 hover:bg-white/10 hover:text-fg"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function SignedOut() {
  const signIn = useSignIn();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-surface px-6 py-12 text-center shadow-surface">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <ShoppingBag className="size-6" aria-hidden />
      </span>
      <p className="text-[20px] font-bold">Your claims and orders live here</p>
      <p className="max-w-sm text-[15px] text-fg-2">Sign in to see what you're holding, what you need to pay for and what you've won.</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Button onClick={() => signIn({ title: "Sign in to Pehle" })}>Sign in</Button>
        <Link to="/try" className={linkButton("secondary")}>
          <Zap className="size-4" /> Try a practice drop
        </Link>
      </div>
    </div>
  );
}

function Orders() {
  const orders = useQuery({
    queryKey: keys.myOrders,
    queryFn: () => unwrap(api.GET("/api/v1/orders/mine")),
    refetchInterval: (q) => (q.state.data?.some((o) => o.status === "awaiting_payment" || o.status === "payment_reported") ? 5_000 : 30_000),
  });
  const groups = useMemo(() => {
    const list = orders.data ?? [];
    const pay = list
      .filter((o) => o.status === "awaiting_payment")
      .sort((a, b) => new Date(a.holdExpiresAt ?? 0).getTime() - new Date(b.holdExpiresAt ?? 0).getTime());
    const won = list.filter((o) => o.status === "paid" || o.status === "payment_reported");
    const past = list.filter((o) => o.status === "expired" || o.status === "cancelled");
    return { pay, won, past };
  }, [orders.data]);
  if (orders.isPending) return <ListSkeleton />;
  const none = !orders.data?.length;
  return (
    <>
      {none ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface px-6 py-10 text-center shadow-surface">
          <p className="text-[17px] font-semibold">Nothing here yet</p>
          <p className="max-w-sm text-[15px] text-fg-2">When you win a claim in a live, it shows up here with its payment timer.</p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link to="/live" className={linkButton("primary")}>
              See who's live
            </Link>
            <Link to="/try" className={linkButton("secondary")}>
              Try a practice drop
            </Link>
          </div>
        </div>
      ) : null}
      {groups.pay.length ? (
        <Group title="Needs payment" sub="Pay before the timer ends or it goes to the next person in line.">
          {groups.pay.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </Group>
      ) : null}
      {groups.won.length ? (
        <Group title="Won">
          {groups.won.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </Group>
      ) : null}
      {groups.past.length ? (
        <Group title="Past">
          {groups.past.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </Group>
      ) : null}
      <Club orders={orders.data ?? []} />
    </>
  );
}

function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[20px] font-bold">{title}</h2>
      {sub ? <p className="text-[13px] text-fg-2">{sub}</p> : null}
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-surface">{children}</ul>
    </section>
  );
}

function statusLine(o: OrderView): { text: string; tone: string } {
  switch (o.status) {
    case "paid":
      if (o.paidVia === "free") return { text: "You won it, free", tone: "text-good" };
      if (o.paidVia === "gateway") return { text: "Paid, verified by Razorpay", tone: "text-good" };
      return { text: "Paid, confirmed by the shop", tone: "text-good" };
    case "payment_reported":
      return { text: "Payment sent, the shop is checking it", tone: "text-info" };
    case "expired":
      return { text: "Hold ran out, it went to the next in line", tone: "text-muted" };
    case "cancelled":
      return { text: "Cancelled", tone: "text-muted" };
    default:
      return { text: "Waiting for payment", tone: "text-gold" };
  }
}

function OrderRow({ order: o }: { order: OrderView }) {
  const status = statusLine(o);
  const past = o.status === "expired" || o.status === "cancelled";
  return (
    <li>
      <Link to="/o/$orderId" params={{ orderId: o.id }} className="flex items-center gap-3 p-3 hover:bg-white/5 focus-visible:-outline-offset-2">
        <PhotoTile path={o.itemImagePath} alt={o.itemTitle} className={cx("size-[72px] shrink-0 sm:size-20", past && "opacity-60")} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold leading-6">{priceLabel(o.amountPaise)}</p>
          <p className="truncate text-[15px] leading-5">{o.itemTitle}</p>
          <p className="truncate text-[13px] text-fg-2">
            {o.shopName}, claimed #{o.claimPosition} {timeAgo(o.createdAt)}
          </p>
          {o.status === "awaiting_payment" ? <PayBy until={o.holdExpiresAt} /> : <p className={cx("truncate text-[13px] font-semibold", status.tone)}>{status.text}</p>}
        </div>
        {o.status === "awaiting_payment" ? (
          <span className={linkButton("primary", "md", "hidden shrink-0 sm:inline-flex")}>Pay now</span>
        ) : (
          <ChevronRight className="size-5 shrink-0 text-fg-2" aria-hidden />
        )}
      </Link>
      {o.status === "paid" && o.winnerNote ? (
        <div className="px-3 pb-3">
          <WinnerNote note={o.winnerNote} shopName={o.shopName} />
        </div>
      ) : null}
    </li>
  );
}

function PayBy({ until }: { until?: string | null }) {
  const left = useCountdown(until);
  const urgent = left < 120_000;
  return (
    <p className={cx("flex items-center gap-1 text-[13px] font-semibold", urgent ? "text-accent" : "text-good")}>
      <Clock className="size-3.5" aria-hidden />
      {left > 0 ? (
        <>
          Pay within <span className="tabular">{clock(left)}</span>
        </>
      ) : (
        "Time's up"
      )}
    </p>
  );
}

/**
 * Shops in your club. There is no list endpoint yet, so check the shops you know about: ones you
 * ordered from, messaged, or that appear in the feed.
 */
function Club(_: { orders: OrderView[] }) {
  const feed = useBrowse();
  const following = useQuery({ queryKey: ["me", "following"], queryFn: () => unwrap(api.GET("/api/v1/me/following")), staleTime: 30_000 });
  const liveHandles = useMemo(() => new Set((feed.data?.live ?? []).map((d) => d.shopHandle)), [feed.data]);
  const loading = following.isPending;
  const clubs = (following.data ?? []).map((shop) => ({ shop, live: liveHandles.has(shop.handle) }));
  return (
    <section>
      <h2 className="flex items-center gap-2 text-[20px] font-bold">
        <Users className="size-5 text-accent" aria-hidden /> Shops in your club
      </h2>
      <p className="text-[13px] text-fg-2">You hear first when these shops go live.</p>
      {loading && clubs.length === 0 ? (
        <div className="mt-2 h-[76px] animate-pulse rounded-xl bg-surface" />
      ) : clubs.length === 0 ? (
        <p className="mt-2 rounded-xl bg-surface px-4 py-5 text-[15px] text-fg-2 shadow-surface">
          You haven't joined a club yet. Open a shop and tap Join club.
        </p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {clubs.map(({ shop, live }) => {
            return (
              <li key={shop.handle}>
                <Link to="/s/$handle" params={{ handle: shop.handle }} className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-surface hover:bg-surface-2">
                  <ShopAvatar name={shop.displayName} path={shop.avatarPath} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{shop.displayName}</p>
                    <p className={cx("truncate text-[13px]", live ? "font-semibold text-live" : "text-fg-2")}>
                      {live ? "Live now" : place(categoryLabel(shop.category), shop.city)}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-fg-2" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-surface">
      <p className="text-[17px] font-semibold">{title}</p>
      <div className="mt-1 text-[15px] text-fg-2">{children}</div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-surface p-3">
          <div className="size-[72px] animate-pulse rounded-lg bg-surface-2 sm:size-20" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
