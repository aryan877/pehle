import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, MapPin, Phone } from "lucide-react";
import { useState } from "react";

import { CancelOrderSheet, CopyButton, OrderStatusBadge, PageHeader, Segmented, priceLabel } from "~/components/studio/bits";
import { useShop } from "~/components/studio/shop-context";
import { Button, CodeChip, Empty, Spinner, cx, errorMessage, useCountdown, useToast } from "~/components/ui";
import { api, keys, unwrap, type OrderView } from "~/lib/api";
import { clock, mediaUrl, timeAgo } from "~/lib/format";

export const Route = createFileRoute("/studio/orders")({
  component: OrdersPage,
});

type Filter = "open" | "paid" | "all";

function OrdersPage() {
  const { shop } = useShop();
  const [filter, setFilter] = useState<Filter>("open");
  const orders = useQuery({
    queryKey: keys.shopOrders(shop.id, filter),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/orders", { params: { path: { shop_id: shop.id }, query: { filter } } })),
    refetchInterval: filter === "open" ? 5_000 : 30_000,
  });
  const openCount = useQuery({
    queryKey: keys.shopOrders(shop.id, "open"),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/orders", { params: { path: { shop_id: shop.id }, query: { filter: "open" } } })),
    refetchInterval: 15_000,
    select: (list) => list.filter((o) => o.status === "payment_reported").length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        subtitle="Confirm a payment only after you see it in your UPI app. Razorpay payments confirm themselves."
        actions={
          filter === "paid" && orders.data?.length ? (
            <Button variant="secondary" onClick={() => downloadCsv(orders.data, shop.handle)}>
              <Download className="size-4" /> Export CSV
            </Button>
          ) : null
        }
      />

      <Segmented<Filter>
        label="Filter orders"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "open", label: "Needs action", count: openCount.data },
          { value: "paid", label: "Paid" },
          { value: "all", label: "All orders" },
        ]}
      />

      {orders.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : orders.isError ? (
        <Empty title="Couldn't load orders">{errorMessage(orders.error)}</Empty>
      ) : orders.data.length === 0 ? (
        <Empty title={filter === "open" ? "Nothing needs you right now." : filter === "paid" ? "No paid orders yet." : "No orders yet."}>
          {filter === "open" ? "When someone wins a claim, their order shows here until they pay or their hold runs out." : "Orders appear here once buyers win claims in a drop."}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {orders.data.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: OrderView }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const left = useCountdown(order.status === "awaiting_payment" ? order.holdExpiresAt : null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shop", shop.id, "orders"] });

  const confirm = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/orders/{order_id}/confirm", { params: { path: { order_id: order.id } } })),
    onSuccess: async () => {
      await refresh();
      toast(`Payment for ${order.itemCode} confirmed. ${order.buyerName} has been told.`, "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => unwrap(api.POST("/api/v1/orders/{order_id}/cancel", { params: { path: { order_id: order.id } }, body: { reason } })),
    onSuccess: async () => {
      setCancelling(false);
      await refresh();
      toast("Order cancelled. The next buyer in line has been offered the item.", "info");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const image = mediaUrl(order.itemImagePath);
  const hasAddress = Boolean(order.shipAddress);
  const address = [order.shipName, order.shipAddress, order.shipPincode, order.shipPhone].filter(Boolean).join(", ");
  const open = order.status === "awaiting_payment" || order.status === "payment_reported";

  return (
    <li className={cx("rounded-xl bg-surface p-3 shadow-surface sm:p-4", order.status === "payment_reported" && "ring-1 ring-inset ring-accent/50")}>
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        {image ? <img src={image} alt="" className="size-16 shrink-0 rounded-lg object-cover" /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CodeChip code={order.itemCode} />
            <p className="min-w-0 truncate font-semibold">{order.itemTitle}</p>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-[14px] text-fg-2">
            <b className="text-fg">{order.buyerName}</b>, claim #{order.claimPosition}, <span className="tabular font-semibold text-fg">{priceLabel(order.amountPaise)}</span>,{" "}
            {timeAgo(order.createdAt)}
          </p>
          {order.status === "awaiting_payment" ? (
            <p className="text-[14px] text-fg-2">
              Hold ends in <span className={cx("tabular font-mono font-bold", left < 60_000 ? "text-accent" : "text-fg")}>{clock(left)}</span>. If unpaid, the
              next buyer is offered it.
            </p>
          ) : null}
          {order.upiReference ? (
            <p className="text-[14px]">
              UPI ref <span className="font-mono font-bold">{order.upiReference}</span>
            </p>
          ) : null}
          {order.paidVia === "gateway" ? <p className="text-[13px] text-good">Confirmed by Razorpay</p> : null}
        </div>
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          {open ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
                Cancel
              </Button>
              <Button variant={order.status === "payment_reported" ? "success" : "secondary"} size="sm" loading={confirm.isPending} onClick={() => confirm.mutate()}>
                {order.status === "payment_reported" ? "Payment received" : "Mark as paid"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {hasAddress ? (
        <div className="mt-3 flex flex-wrap items-start gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-[14px]">
          <MapPin className="mt-0.5 size-4 shrink-0 text-fg-2" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{order.shipName}</p>
            <p className="text-fg-2">
              {order.shipAddress}, {order.shipPincode}
            </p>
            {order.shipPhone ? (
              <a href={`tel:${order.shipPhone}`} className="mt-0.5 inline-flex items-center gap-1 font-semibold text-accent">
                <Phone className="size-3.5" /> {order.shipPhone}
              </a>
            ) : null}
          </div>
          <CopyButton text={address} label="Copy address" />
        </div>
      ) : null}

      {cancelling ? (
        <CancelOrderSheet open onClose={() => setCancelling(false)} busy={cancel.isPending} itemCode={order.itemCode} buyerName={order.buyerName} onConfirm={(r) => cancel.mutate(r)} />
      ) : null}
    </li>
  );
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula injection, then quote.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadCsv(orders: OrderView[], handle: string) {
  const header = ["Paid at", "Item code", "Item", "Amount (INR)", "Buyer", "UPI reference", "Ship to", "Phone", "Address", "Pincode"];
  const rows = orders.map((o) => [
    o.paidAt ? new Date(o.paidAt).toLocaleString("en-IN") : "",
    o.itemCode,
    o.itemTitle,
    (o.amountPaise / 100).toFixed(2),
    o.buyerName,
    o.upiReference ?? "",
    o.shipName ?? "",
    o.shipPhone ?? "",
    o.shipAddress ?? "",
    o.shipPincode ?? "",
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pehle-${handle}-paid-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
