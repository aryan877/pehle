import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Clock, Copy, FlaskConical, Gift, IndianRupee, MessageCircle, ShieldCheck, Smartphone, Wand2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type ReactNode } from "react";

import { ShopAvatar, WinnerNote, linkButton, priceLabel } from "~/components/browse";
import { AppShell } from "~/components/shell";
import { Badge, Button, CodeChip, Field, Input, Textarea, cx, errorMessage, useCountdown, useToast } from "~/components/ui";
import { api, keys, unwrap, type Checkout } from "~/lib/api";
import { clock, mediaUrl, possessive, rupees, timeAgo } from "~/lib/format";

export const Route = createFileRoute("/o/$orderId")({
  component: CheckoutPage,
});

const STATUS: Record<string, { label: string; tone: "held" | "wait" | "info" | "muted" | "danger" }> = {
  awaiting_payment: { label: "Waiting for payment", tone: "wait" },
  payment_reported: { label: "Payment reported", tone: "info" },
  paid: { label: "Paid", tone: "held" },
  expired: { label: "Hold ran out", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

function CheckoutPage() {
  const { orderId } = Route.useParams();
  const order = useQuery({
    queryKey: keys.order(orderId),
    queryFn: () => unwrap(api.GET("/api/v1/orders/{order_id}", { params: { path: { order_id: orderId } } })),
    refetchInterval: (q) => (q.state.data && ["paid", "expired", "cancelled"].includes(q.state.data.status) ? false : 4_000),
  });
  const queryClient = useQueryClient();
  // Returning from the payment page, or waiting on a gateway payment: ask the server to check now.
  const awaitingGateway = Boolean(order.data?.gateway && order.data.paymentLinkUrl && order.data.status === "awaiting_payment");
  useEffect(() => {
    const returned = new URLSearchParams(window.location.search).has("razorpay_payment_link_status");
    if (!returned && !awaitingGateway) return;
    let stop = false;
    const check = async () => {
      try {
        const fresh = await unwrap(api.POST("/api/v1/orders/{order_id}/check", { params: { path: { order_id: orderId } } }));
        if (!stop) queryClient.setQueryData(keys.order(orderId), fresh);
      } catch {
        /* the regular refetch keeps trying */
      }
    };
    void check();
    const id = window.setInterval(check, 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [awaitingGateway, orderId, queryClient]);

  if (order.isPending) {
    return (
      <AppShell bare>
        <CheckoutSkeleton />
      </AppShell>
    );
  }
  if (order.isError || !order.data) {
    return (
      <AppShell>
        <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-display text-[28px] font-bold">Order not found</p>
          <p className="text-fg-2">Open this link on the phone you claimed with, signed in to the same account.</p>
          <Link to="/me" className={linkButton("secondary")}>
            Go to Buying
          </Link>
        </div>
      </AppShell>
    );
  }
  const o = order.data;
  const status = STATUS[o.status] ?? { label: o.status, tone: "muted" as const };
  const free = o.paidVia === "free";
  const demo = o.shopIsDemo;

  return (
    <AppShell bare>
      <div className="lg:grid lg:min-h-[calc(100dvh-56px)] lg:grid-cols-[minmax(0,1fr)_minmax(400px,500px)]">
        <Media path={o.itemImagePath} title={o.itemTitle} code={o.itemCode} />

        <aside className="min-w-0 border-line bg-surface lg:border-l">
          <div className="space-y-5 px-4 py-4 sm:px-5 lg:py-5">
            <div className="flex items-center justify-between gap-3">
              <Link
                to="/l/$slug"
                params={{ slug: o.liveSlug }}
                className="-ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[14px] font-semibold text-fg-2 hover:text-fg"
              >
                <ArrowLeft className="size-4" aria-hidden /> Back to the live
              </Link>
              <Badge tone="neutral" className="font-mono">
                {o.reference}
              </Badge>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CodeChip code={o.itemCode} />
                <Badge tone={free && o.status === "paid" ? "held" : status.tone}>{free && o.status === "paid" ? "Won" : status.label}</Badge>
              </div>
              <h1 className="mt-2 text-[24px] font-bold leading-tight">{o.itemTitle}</h1>
              <p className={cx("tabular mt-1 font-display text-[30px] font-extrabold leading-tight", free ? "text-good" : "text-gold")}>
                {priceLabel(o.amountPaise)}
              </p>
              <p className="mt-1 text-[15px] text-fg-2">
                Claimed #{o.claimPosition} in {possessive(o.shopName)} live, {timeAgo(o.createdAt)}
              </p>
            </div>

            <Link
              to="/s/$handle"
              params={{ handle: o.shopHandle }}
              className="flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-white/5"
            >
              <ShopAvatar name={o.shopName} path={o.shopAvatarPath} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.shopName}</p>
                <p className="text-[13px] text-fg-2">{o.viewerIsStaff ? "Your shop" : "Seller"}</p>
              </div>
              <span className="text-[13px] font-semibold text-info">See shop</span>
            </Link>

            {o.status === "awaiting_payment" ? <HoldTimer until={o.holdExpiresAt} buyerName={o.viewerIsStaff ? o.buyerName : null} /> : null}

            {demo && !free && (o.status === "awaiting_payment" || o.status === "payment_reported") ? (
              <div className="flex gap-3 rounded-xl border border-info/25 bg-info-soft p-3">
                <FlaskConical className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
                <p className="text-[14px] text-fg">
                  This is a demo shop, so payments are simulated. Nobody is charged, nothing ships, and the demo seller confirms
                  in a few seconds.
                </p>
              </div>
            ) : null}

            {o.viewerIsStaff ? <StaffView order={o} /> : <BuyerSteps order={o} demo={demo} />}

            {!o.viewerIsStaff ? (
              <Link to="/inbox" search={{ shop: o.shopHandle }} className={cx(linkButton("secondary"), "w-full")}>
                <MessageCircle className="size-4" aria-hidden /> Message {o.shopName}
              </Link>
            ) : null}

            <p className="text-[13px] text-fg-2">
              Who claimed first is public.{" "}
              <Link to="/fair/$slug" params={{ slug: o.liveSlug }} className="font-semibold text-info hover:underline">
                See the fairness log
              </Link>
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

/** Marketplace's media viewer: the photo contained over a blurred copy of itself. */
function Media({ path, title, code }: { path?: string | null; title: string; code: string }) {
  const src = mediaUrl(path);
  return (
    <div className="relative h-[min(62vw,420px)] overflow-hidden bg-black lg:sticky lg:top-14 lg:h-[calc(100dvh-56px)]">
      {src ? (
        <>
          <img src={src} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl" />
          <img src={src} alt={title} className="relative mx-auto size-full object-contain" />
        </>
      ) : (
        <div className="flex size-full items-center justify-center">
          <CodeChip code={code} className="text-[20px]" />
        </div>
      )}
    </div>
  );
}

function Block({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border-t border-line pt-4", className)}>
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function HoldTimer({ until, buyerName }: { until: string | null | undefined; buyerName: string | null }) {
  const left = useCountdown(until);
  const urgent = left < 120_000;
  return (
    <div
      className={cx("flex items-center gap-3 rounded-xl border px-4 py-3", urgent ? "border-accent/25 bg-accent-soft" : "border-good/25 bg-good-soft")}
      role="timer"
      aria-live="off"
    >
      <Clock className={cx("size-5 shrink-0", urgent ? "text-accent" : "text-good")} aria-hidden />
      <p className={cx("flex-1 text-[15px] font-semibold", urgent ? "text-accent" : "text-good")}>
        {buyerName
          ? left > 0
            ? `Held for ${buyerName}. If unpaid, it goes to the next buyer.`
            : "Time's up. The next buyer is being offered the item."
          : left > 0
            ? "Held for you. Pay before the timer ends."
            : "Time's up. Report your payment now if you already paid."}
      </p>
      <span className={cx("tabular font-mono text-[26px] font-bold", urgent ? "text-accent" : "text-good")}>{clock(left)}</span>
    </div>
  );
}

function BuyerSteps({ order, demo }: { order: Checkout; demo: boolean }) {
  if (order.status === "paid" && order.paidVia === "free") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft p-4">
          <Gift className="mt-0.5 size-7 shrink-0 text-good" aria-hidden />
          <div>
            <p className="text-[20px] font-bold text-good">You won it</p>
            <p className="text-[15px] text-fg-2">Free, and the first to claim wins it. Nothing to pay.</p>
          </div>
        </div>
        {order.winnerNote ? (
          <WinnerNote note={order.winnerNote} shopName={order.shopName} />
        ) : (
          <p className="text-[15px] text-fg-2">{order.shopName} will message you with the details.</p>
        )}
      </div>
    );
  }
  if (order.status === "paid") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-good/30 bg-good-soft p-4">
          <CheckCircle2 className="mt-0.5 size-7 shrink-0 text-good" aria-hidden />
          <div>
            <p className="text-[18px] font-bold text-good">{order.paidVia === "gateway" ? "Paid. Order confirmed" : "Payment confirmed"}</p>
            <p className="text-[15px] text-fg-2">
              {demo
                ? "The demo seller confirmed your simulated payment. In a real shop, this is when it ships."
                : `${order.shopName} will ship to ${order.shipName}, ${order.shipPincode}.`}
              {order.gatewayRrn ? ` UPI reference ${order.gatewayRrn}.` : ""}
            </p>
          </div>
        </div>
        {order.winnerNote ? <WinnerNote note={order.winnerNote} shopName={order.shopName} /> : null}
      </div>
    );
  }
  if (order.status === "payment_reported") {
    return (
      <div className="rounded-xl border border-info/25 bg-info-soft p-4">
        <p className="text-[17px] font-bold">Thanks! The shop is checking your payment.</p>
        <p className="mt-1 text-[15px] text-fg-2">
          UPI reference <b className="font-mono text-fg">{order.upiReference}</b>. You'll get a message as soon as it's confirmed.
        </p>
      </div>
    );
  }
  if (order.status === "expired" || order.status === "cancelled") {
    return (
      <div className="rounded-xl border border-line p-4">
        <p className="text-[17px] font-bold">{order.status === "expired" ? "This hold ran out" : "This order was cancelled"}</p>
        <p className="mt-1 text-[15px] text-fg-2">
          {order.refundId
            ? `Your payment came in after the hold ended, so it is being refunded automatically (refund ${order.refundId}). Refunds reach your account in 5 to 7 working days.`
            : "The item went to the next person in line. If you paid already, message the shop with your UPI reference."}
        </p>
        <Link to="/l/$slug" params={{ slug: order.liveSlug }} className={linkButton("secondary", "md", "mt-3")}>
          Back to the live
        </Link>
      </div>
    );
  }
  if (order.gateway) return <GatewayPay order={order} demo={demo} />;
  return (
    <>
      {demo && !order.upiUrl ? <DemoPayStep order={order} /> : <PayStep order={order} />}
      <ReportStep order={order} demo={demo} />
    </>
  );
}

/** Shops with Razorpay connected: delivery details, then the hosted payment page; confirmation is automatic. */
function GatewayPay({ order, demo }: { order: Checkout; demo: boolean }) {
  const toast = useToast();
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({
    shipName: order.shipName ?? order.buyerName,
    shipPhone: order.shipPhone ?? "",
    shipAddress: order.shipAddress ?? "",
    shipPincode: order.shipPincode ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/orders/{order_id}/pay", { params: { path: { order_id: order.id } }, body: form })),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  if (manual) {
    return (
      <>
        <PayStep order={order} />
        <ReportStep order={order} demo={demo} />
        <button onClick={() => setManual(false)} className="mx-auto block rounded text-[13px] font-semibold text-fg-2 underline-offset-4 hover:underline">
          Back to secure checkout
        </button>
      </>
    );
  }
  return (
    <Block title="Pay securely, confirmed instantly" icon={<ShieldCheck className="size-5 text-good" />}>
      <p className="text-[15px] text-fg-2">
        Pay {order.shopName} by UPI, card or netbanking. Your order is confirmed the moment the payment goes through, so nobody can take
        it from you.
      </p>
      {demo ? (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          Razorpay runs in test mode here. Choose UPI and enter <b className="font-mono text-fg">success@razorpay</b>, or use a Razorpay
          test card. Nothing is charged.
        </p>
      ) : null}
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          pay.mutate();
        }}
      >
        <Field label="Name for delivery" htmlFor="g-name">
          <Input id="g-name" value={form.shipName} onChange={set("shipName")} autoComplete="name" required />
        </Field>
        <Field label="Phone" htmlFor="g-phone">
          <Input id="g-phone" inputMode="tel" value={form.shipPhone} onChange={set("shipPhone")} autoComplete="tel" placeholder="98100 00000" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Full address" htmlFor="g-address">
            <Textarea id="g-address" value={form.shipAddress} onChange={set("shipAddress")} autoComplete="street-address" placeholder="House, street, area, city" required />
          </Field>
        </div>
        <Field label="Pincode" htmlFor="g-pin">
          <Input id="g-pin" inputMode="numeric" maxLength={6} value={form.shipPincode} onChange={set("shipPincode")} autoComplete="postal-code" required />
        </Field>
        <div className="flex items-end">
          <Button type="submit" size="lg" variant="success" block loading={pay.isPending}>
            <IndianRupee className="size-4" /> Pay {rupees(order.amountPaise)}
          </Button>
        </div>
        {error ? (
          <p className="text-[14px] text-accent sm:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {order.paymentLinkUrl ? (
        <p className="mt-3 text-[13px] text-fg-2">
          Already opened the payment page?{" "}
          <a href={order.paymentLinkUrl} className="font-semibold text-fg underline-offset-4 hover:underline">
            Open it again
          </a>
          . This page updates by itself once you've paid.
        </p>
      ) : null}
      {order.upiUrl ? (
        <button
          onClick={() => {
            setManual(true);
            toast("Paying directly means the shop confirms by hand, which can take a while.", "info");
          }}
          className="mt-3 rounded text-[13px] font-semibold text-fg-2 underline-offset-4 hover:underline"
        >
          Pay to the shop's UPI ID instead
        </button>
      ) : null}
    </Block>
  );
}

function PayStep({ order }: { order: Checkout }) {
  const toast = useToast();
  const [isPhone, setIsPhone] = useState(true);
  useEffect(() => setIsPhone(/Android|iPhone|iPad/i.test(navigator.userAgent)), []);
  if (!order.upiUrl) {
    return (
      <Block title="1. Pay the shop">
        <p className="text-[15px] text-fg-2">This shop hasn't added a UPI ID yet. They'll send payment details in a message.</p>
      </Block>
    );
  }
  return (
    <Block title={`1. Pay ${rupees(order.amountPaise)} with any UPI app`}>
      <p className="text-[15px] text-fg-2">
        To <b className="text-fg">{order.upiPayeeName ?? order.shopName}</b> ({order.upiVpa}). The note <b className="font-mono text-fg">{order.reference}</b> is
        filled in for you.
      </p>
      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {!isPhone ? (
          <div className="shrink-0 rounded-xl bg-white p-3">
            <QRCodeSVG value={order.upiUrl} size={152} level="M" title={`UPI payment of ${rupees(order.amountPaise)} to ${order.upiPayeeName ?? order.shopName}`} />
            <p className="mt-2 text-center text-[12px] text-[#555]">Scan with your UPI app</p>
          </div>
        ) : null}
        <div className="w-full space-y-2">
          <a href={order.upiUrl} className={linkButton("success", "xl", "w-full")}>
            <Smartphone className="size-5" aria-hidden /> Pay {rupees(order.amountPaise)} in UPI app
          </a>
          <Button
            variant="secondary"
            block
            onClick={() => {
              void navigator.clipboard.writeText(order.upiVpa ?? "");
              toast("UPI ID copied", "success");
            }}
          >
            <Copy className="size-4" /> Copy UPI ID
          </Button>
        </div>
      </div>
    </Block>
  );
}

/** The practice shop has no UPI ID: explain what a real shop would show. */
function DemoPayStep({ order }: { order: Checkout }) {
  return (
    <Block title="1. Pay (simulated)">
      <p className="text-[15px] text-fg-2">
        In a real shop this opens your UPI app with {rupees(order.amountPaise)} and the note <b className="font-mono text-fg">{order.reference}</b>{" "}
        filled in, or a Razorpay checkout. Here, skip to step 2 and use the test details.
      </p>
    </Block>
  );
}

const DEMO_DETAILS = { upiReference: "412345678901", shipPhone: "9810000000", shipAddress: "Practice address, 12 MG Road, Bengaluru", shipPincode: "560001" };

function ReportStep({ order, demo }: { order: Checkout; demo: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ upiReference: "", shipName: order.buyerName, shipPhone: "", shipAddress: "", shipPincode: "" });
  const [error, setError] = useState<string | null>(null);
  const report = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/orders/{order_id}/payment", { params: { path: { order_id: order.id } }, body: form })),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.order(order.id), data);
      void queryClient.invalidateQueries({ queryKey: keys.myOrders });
      toast(demo ? "Payment reported. The demo seller confirms in a few seconds." : "Payment reported. The shop will confirm shortly.", "success");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Block title="2. Tell the shop you've paid">
      <p className="text-[15px] text-fg-2">Your phone and address go only to {order.shopName}, only for this order.</p>
      {demo ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setForm((f) => ({ ...f, ...DEMO_DETAILS }))}>
          <Wand2 className="size-4" /> Fill in test details
        </Button>
      ) : null}
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          report.mutate();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="UPI reference number" hint="12 digits, shown in your UPI app after paying (UTR or UPI Ref No.)" htmlFor="utr">
            <Input id="utr" inputMode="numeric" value={form.upiReference} onChange={set("upiReference")} placeholder="412345678901" required />
          </Field>
        </div>
        <Field label="Name for delivery" htmlFor="ship-name">
          <Input id="ship-name" value={form.shipName} onChange={set("shipName")} autoComplete="name" required />
        </Field>
        <Field label="Phone" htmlFor="ship-phone">
          <Input id="ship-phone" inputMode="tel" value={form.shipPhone} onChange={set("shipPhone")} autoComplete="tel" placeholder="98100 00000" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Full address" htmlFor="ship-address">
            <Textarea id="ship-address" value={form.shipAddress} onChange={set("shipAddress")} autoComplete="street-address" placeholder="House, street, area, city" required />
          </Field>
        </div>
        <Field label="Pincode" htmlFor="ship-pin">
          <Input id="ship-pin" inputMode="numeric" maxLength={6} value={form.shipPincode} onChange={set("shipPincode")} autoComplete="postal-code" required />
        </Field>
        <div className="flex items-end">
          <Button type="submit" size="lg" block loading={report.isPending}>
            <IndianRupee className="size-4" /> I've paid
          </Button>
        </div>
        {error ? (
          <p className="text-[14px] text-accent sm:col-span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Block>
  );
}

function StaffView({ order }: { order: Checkout }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = (data: unknown) => queryClient.setQueryData(keys.order(order.id), { ...order, ...(data as object) });
  const confirm = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/orders/{order_id}/confirm", { params: { path: { order_id: order.id } } })),
    onSuccess: (d) => {
      refresh(d);
      toast("Payment confirmed", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const cancel = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/orders/{order_id}/cancel", { params: { path: { order_id: order.id } }, body: { reason: "Payment not received" } })),
    onSuccess: (d) => {
      refresh(d);
      toast("Order cancelled. The next buyer was offered the item.", "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const open = order.status === "awaiting_payment" || order.status === "payment_reported";
  return (
    <Block title={`Buyer: ${order.buyerName}`}>
      <div className="space-y-3">
        {order.paidVia === "free" ? (
          <p className="text-[15px] text-fg-2">A free item: the first claim won it on the spot. No payment to check.</p>
        ) : order.upiReference ? (
          <p className="text-[15px]">
            UPI reference <b className="font-mono">{order.upiReference}</b>. Check it in your UPI app before confirming.
          </p>
        ) : order.paidVia === "gateway" ? (
          <p className="text-[15px] text-fg-2">Paid through Razorpay{order.gatewayRrn ? `, UPI reference ${order.gatewayRrn}` : ""}. Confirmed automatically.</p>
        ) : (
          <p className="text-[15px] text-fg-2">No payment reported yet.</p>
        )}
        {order.shipAddress ? (
          <div className="rounded-xl bg-surface-2 p-3 text-[15px]">
            <p className="font-semibold">{order.shipName}</p>
            <p className="text-fg-2">{order.shipPhone}</p>
            <p className="mt-1 whitespace-pre-line">
              {order.shipAddress} {order.shipPincode}
            </p>
          </div>
        ) : null}
        {order.winnerNote ? <WinnerNote note={order.winnerNote} shopName={order.shopName} heading="Your private note to the winner" /> : null}
        {open ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="success" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Confirm payment
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel and offer to next
            </Button>
          </div>
        ) : null}
      </div>
    </Block>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-56px)] lg:grid-cols-[minmax(0,1fr)_minmax(400px,500px)]" role="status" aria-label="Loading order">
      <div className="h-[min(62vw,420px)] animate-pulse bg-surface-2 lg:h-[calc(100dvh-56px)]" />
      <div className="space-y-4 bg-surface p-5">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
        <div className="h-7 w-4/5 animate-pulse rounded bg-surface-2" />
        <div className="h-8 w-28 animate-pulse rounded bg-surface-2" />
        <div className="h-16 animate-pulse rounded-xl bg-surface-2" />
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      </div>
    </div>
  );
}
