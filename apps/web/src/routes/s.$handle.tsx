import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Check, Info, MessageCircle, Share2, ShieldCheck, Users, Zap } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import {
  CardSkeleton,
  CatalogueTile,
  LiveCard,
  PastCard,
  ShopAvatar,
  UpcomingCard,
  cardGrid,
  count,
  linkButton,
  tileGrid4,
} from "~/components/browse";
import { AppShell, categoryLabel } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Badge, Button, colourFor, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type ShopPage, type TrustRecord } from "~/lib/api";
import { mediaUrl } from "~/lib/format";
import { buyerOf, useSession } from "~/lib/session";

export const Route = createFileRoute("/s/$handle")({ component: Shop });

function Shop() {
  const { handle } = Route.useParams();
  const page = useQuery({
    queryKey: keys.shopPage(handle),
    queryFn: () => unwrap(api.GET("/api/v1/shops/by-handle/{handle}/page", { params: { path: { handle } } })),
    refetchInterval: 30_000,
  });
  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] pb-6">
        {page.isPending ? (
          <ShopSkeleton />
        ) : page.isError || !page.data ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-display text-[28px] font-bold">Shop not found</p>
            <p className="max-w-sm text-fg-2">This shop link may have changed. Find it from a live drop instead.</p>
            <Link to="/" className={linkButton("secondary")}>
              Browse drops
            </Link>
          </div>
        ) : (
          <ShopBody data={page.data} />
        )}
      </div>
    </AppShell>
  );
}

function ShopBody({ data }: { data: ShopPage }) {
  const { shop, trust, drops, items } = data;
  const [tab, setTab] = useState<"drops" | "catalogue">("drops");
  const tabsId = useId();
  const live = drops.filter((d) => d.status === "live");
  const upcoming = drops.filter((d) => d.status === "draft");
  const past = drops.filter((d) => d.status === "ended");
  const liveSlug = live[0]?.slug;
  return (
    <>
      <Cover name={shop.displayName} cover={shop.coverPath} avatar={shop.avatarPath} />

      <div className="relative px-1 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-5">
          <ShopAvatar name={shop.displayName} path={shop.avatarPath} size={128} className="-mt-14 ring-4 ring-canvas sm:-mt-16" />
          <div className="min-w-0 flex-1 md:pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words font-display text-[30px] font-bold leading-tight sm:text-[34px]">{shop.displayName}</h1>
              {trust.acceptsGatewayPayments ? (
                <Badge tone="held" className="gap-1">
                  <BadgeCheck className="size-3.5" aria-hidden /> Razorpay checkout
                </Badge>
              ) : null}
              {shop.isDemo ? <Badge tone="wait">Practice shop</Badge> : null}
            </div>
            {shop.tagline ? <p className="mt-1 max-w-2xl text-[15px] text-fg">{shop.tagline}</p> : null}
            <p className="mt-1 text-[15px] text-fg-2">
              {[categoryLabel(shop.category), shop.city].filter(Boolean).join(", ")}
              {trust.followers > 0 ? `. ${count(trust.followers, "club member", "club members")}` : ""}
            </p>
          </div>
          <ShopActions data={data} />
        </div>
      </div>

      {shop.isDemo ? (
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-gold/25 bg-gold-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-fg">
            {shop.handle === "pehle-demo"
              ? "This is Pehle's practice shop. Four scripted rivals race you for one piece; claims and holds are real, nothing ships."
              : "This is a practice shop. Claims and holds are real, payments are simulated and nothing ships."}
          </p>
          <Link to="/try" className={linkButton("primary", "md", "shrink-0")}>
            <Zap className="size-4" /> Start a race
          </Link>
        </div>
      ) : null}

      <TrustStrip trust={trust} />

      <div className="mt-6 border-b border-line" role="tablist" aria-label="Shop sections">
        <TabButton id={`${tabsId}-drops`} panel={`${tabsId}-drops-panel`} active={tab === "drops"} onClick={() => setTab("drops")}>
          Drops <span className="text-fg-2">{drops.length}</span>
        </TabButton>
        <TabButton id={`${tabsId}-cat`} panel={`${tabsId}-cat-panel`} active={tab === "catalogue"} onClick={() => setTab("catalogue")}>
          Catalogue <span className="text-fg-2">{items.length}</span>
        </TabButton>
      </div>

      {tab === "drops" ? (
        <div id={`${tabsId}-drops-panel`} role="tabpanel" aria-labelledby={`${tabsId}-drops`} className="space-y-8 pt-5">
          {drops.length === 0 ? (
            <EmptyLine>
              {shop.displayName} has not scheduled a drop yet. Join the club and you'll hear first when they do.
            </EmptyLine>
          ) : null}
          {live.length ? (
            <ShopSection title="Live now">
              <div className={cardGrid}>
                {live.map((d) => (
                  <LiveCard key={d.id} drop={d} />
                ))}
              </div>
            </ShopSection>
          ) : null}
          {upcoming.length ? (
            <ShopSection title="Coming up">
              <div className={cardGrid}>
                {upcoming.map((d) => (
                  <UpcomingCard key={d.id} drop={d} />
                ))}
              </div>
            </ShopSection>
          ) : null}
          {past.length ? (
            <ShopSection title="Past drops">
              <div className={cardGrid}>
                {past.map((d) => (
                  <PastCard key={d.id} drop={d} />
                ))}
              </div>
            </ShopSection>
          ) : null}
        </div>
      ) : (
        <div id={`${tabsId}-cat-panel`} role="tabpanel" aria-labelledby={`${tabsId}-cat`} className="pt-5">
          {items.length === 0 ? (
            <EmptyLine>No pieces listed yet.</EmptyLine>
          ) : (
            <div className={tileGrid4}>
              {items.map((item) => (
                <CatalogueTile key={item.id} item={item} liveSlug={liveSlug} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Cover({ name, cover, avatar }: { name: string; cover?: string | null; avatar?: string | null }) {
  const colour = colourFor(name);
  const coverSrc = mediaUrl(cover);
  const avatarSrc = mediaUrl(avatar);
  return (
    <div
      className="relative h-[150px] overflow-hidden rounded-xl sm:h-[230px]"
      style={{ background: `linear-gradient(135deg, ${colour} 0%, ${colour}55 45%, #252728 100%)` }}
    >
      {coverSrc ? (
        <img src={coverSrc} alt="" className="size-full object-cover" />
      ) : avatarSrc ? (
        <img src={avatarSrc} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-2xl" />
      ) : null}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-canvas/80 to-transparent" aria-hidden />
    </div>
  );
}

function ShopActions({ data }: { data: ShopPage }) {
  const { shop } = data;
  const session = useSession();
  const buyer = buyerOf(session.data);
  const signIn = useSignIn();
  const toast = useToast();
  const queryClient = useQueryClient();
  const follow = useMutation({
    mutationFn: async (join: boolean) => {
      const path = { params: { path: { handle: shop.handle } } };
      await unwrap(join ? api.POST("/api/v1/shops/by-handle/{handle}/follow", path) : api.DELETE("/api/v1/shops/by-handle/{handle}/follow", path));
      return join;
    },
    onSuccess: (join) => {
      queryClient.setQueryData(keys.shopPage(shop.handle), (old: ShopPage | undefined) =>
        old ? { ...old, following: join, trust: { ...old.trust, followers: Math.max(0, old.trust.followers + (join ? 1 : -1)) } } : old,
      );
      void queryClient.invalidateQueries({ queryKey: keys.shopPage(shop.handle) });
      toast(join ? `You're in the ${shop.displayName} club` : "You left the club", join ? "success" : "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const share = async () => {
    const url = `${window.location.origin}/s/${shop.handle}`;
    try {
      if (navigator.share) await navigator.share({ title: shop.displayName, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Shop link copied", "success");
      }
    } catch {
      /* the share sheet was closed */
    }
  };
  return (
    <div className="md:max-w-[340px] md:pt-3">
      <div className="flex flex-wrap gap-2">
        {data.following ? (
          <Button variant="secondary" onClick={() => follow.mutate(false)} loading={follow.isPending} aria-pressed="true">
            <Check className="size-4" /> In club
          </Button>
        ) : (
          <Button
            onClick={() =>
              buyer
                ? follow.mutate(true)
                : signIn({ title: `Join the ${shop.displayName} club`, reason: "Club members hear first when this shop goes live. Sign in once and leave whenever you like." })
            }
            loading={follow.isPending}
            aria-pressed="false"
          >
            <Users className="size-4" /> Join club
          </Button>
        )}
        <Link to="/inbox" search={{ shop: shop.handle }} className={linkButton("secondary")}>
          <MessageCircle className="size-4" /> Message
        </Link>
        <Button variant="secondary" onClick={() => void share()} aria-label="Share this shop">
          <Share2 className="size-4" />
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-fg-2">Club members hear first when this shop goes live.</p>
    </div>
  );
}

function TrustStrip({ trust }: { trust: TrustRecord }) {
  const stats: { value: string; label: string; good?: boolean }[] = [
    { value: trust.dropsRun.toLocaleString("en-IN"), label: trust.dropsRun === 1 ? "drop run" : "drops run" },
    { value: trust.itemsSold.toLocaleString("en-IN"), label: trust.itemsSold === 1 ? "item sold" : "items sold" },
    { value: trust.gatewayVerified.toLocaleString("en-IN"), label: "paid via gateway, verified by Razorpay", good: trust.gatewayVerified > 0 },
  ];
  if (trust.completionRate != null) stats.push({ value: `${Math.round(trust.completionRate * 100)}%`, label: "of holds ended paid", good: trust.completionRate >= 0.8 });
  if (trust.medianMinutesToPay != null) stats.push({ value: minutes(trust.medianMinutesToPay), label: "median time to pay" });
  stats.push({ value: trust.followers.toLocaleString("en-IN"), label: trust.followers === 1 ? "club member" : "club members" });
  if (trust.sellingSince) {
    stats.push({ value: new Date(trust.sellingSince).toLocaleDateString("en-IN", { month: "short", year: "numeric" }), label: "selling since" });
  }
  return (
    <section aria-labelledby="record" className="mt-6 rounded-xl bg-surface p-4 shadow-surface">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-good" aria-hidden />
        <h2 id="record" className="text-[17px] font-semibold">
          Shop record
        </h2>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse justify-end rounded-lg bg-surface-2 px-3 py-2.5">
            <dt className="text-[13px] leading-snug text-fg-2">{s.label}</dt>
            <dd className={cx("tabular font-display text-[22px] font-bold leading-7", s.good ? "text-good" : "text-fg")}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-1.5 text-[13px] text-fg-2">
        <Info className="mt-[1px] size-3.5 shrink-0" aria-hidden />
        These numbers come from real claims and payments on Pehle. The shop cannot edit them.
      </p>
    </section>
  );
}

function minutes(m: number): string {
  if (m < 1) return "under 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function TabButton({ id, panel, active, onClick, children }: { id: string; panel: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panel}
      onClick={onClick}
      className={cx(
        "relative -mb-px inline-flex h-12 items-center gap-1.5 rounded-t-lg px-4 text-[15px] font-semibold",
        active ? "text-accent" : "text-fg-2 hover:bg-white/5 hover:text-fg",
      )}
    >
      {children}
      {active ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-accent" aria-hidden /> : null}
    </button>
  );
}

function ShopSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[20px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface px-4 py-8 text-center text-[15px] text-fg-2 shadow-surface">{children}</p>;
}

function ShopSkeleton() {
  return (
    <div aria-label="Loading shop" role="status">
      <div className="h-[150px] animate-pulse rounded-xl bg-surface-2 sm:h-[230px]" />
      <div className="relative flex flex-col gap-3 px-1 sm:px-6 md:flex-row md:items-start md:gap-5">
        <div className="-mt-14 size-32 animate-pulse rounded-full bg-surface-3 ring-4 ring-canvas sm:-mt-16" />
        <div className="flex-1 space-y-2 md:pt-3">
          <div className="h-7 w-56 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
      <div className="mt-6 h-40 animate-pulse rounded-xl bg-surface" />
      <div className={cx(cardGrid, "mt-8")}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
