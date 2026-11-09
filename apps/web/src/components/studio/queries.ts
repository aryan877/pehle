import { useQuery } from "@tanstack/react-query";

import { api, keys, unwrap, type ItemWithCounts, type Live } from "~/lib/api";

/** The shop's catalogue with live counts. */
export function useItems(shopId: string) {
  return useQuery({
    queryKey: keys.items(shopId),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/items", { params: { path: { shop_id: shopId } } })),
  });
}

/** Every drop the shop has made, newest first, the running one on top. */
export function useLives(shopId: string) {
  return useQuery({
    queryKey: keys.lives(shopId),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/lives", { params: { path: { shop_id: shopId } } })),
    refetchInterval: 20_000,
  });
}

export function useStats(shopId: string) {
  return useQuery({
    queryKey: keys.shopStats(shopId),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/stats", { params: { path: { shop_id: shopId } } })),
    refetchInterval: 30_000,
  });
}

export function useOpenOrders(shopId: string, refetchInterval = 15_000) {
  return useQuery({
    queryKey: keys.shopOrders(shopId, "open"),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/orders", { params: { path: { shop_id: shopId }, query: { filter: "open" } } })),
    refetchInterval,
  });
}

/** Orders where the buyer says they paid and the seller still has to check. */
export function usePendingPayments(shopId: string) {
  const orders = useOpenOrders(shopId);
  return orders.data?.filter((o) => o.status === "payment_reported").length ?? 0;
}

export function useApprovals(shopId: string, refetchInterval = 15_000) {
  return useQuery({
    queryKey: keys.approvals(shopId),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/approvals", { params: { path: { shop_id: shopId } } })),
    refetchInterval,
  });
}

export function useLineup(liveId: string | null | undefined) {
  return useQuery({
    queryKey: keys.lineup(liveId ?? ""),
    queryFn: () => unwrap(api.GET("/api/v1/lives/{live_id}/lineup", { params: { path: { live_id: liveId! } } })),
    enabled: Boolean(liveId),
  });
}

export function useReport(liveId: string | null | undefined) {
  return useQuery({
    queryKey: keys.report(liveId ?? ""),
    queryFn: () => unwrap(api.GET("/api/v1/lives/{live_id}/report", { params: { path: { live_id: liveId! } } })),
    enabled: Boolean(liveId),
  });
}

export function useConsole(liveId: string, refetchInterval: number | false = 3_000) {
  return useQuery({
    queryKey: keys.console(liveId),
    queryFn: () => unwrap(api.GET("/api/v1/lives/{live_id}/console", { params: { path: { live_id: liveId } } })),
    refetchInterval,
  });
}

/** Drops grouped the way sellers think about them. Upcoming soonest first, past newest first. */
export function groupLives(lives: Live[] | undefined) {
  const list = lives ?? [];
  const live = list.filter((l) => l.status === "live");
  const upcoming = list
    .filter((l) => l.status === "draft")
    .sort((a, b) => sortTime(a.scheduledFor ?? a.createdAt) - sortTime(b.scheduledFor ?? b.createdAt));
  const past = list
    .filter((l) => l.status === "ended")
    .sort((a, b) => sortTime(b.endedAt ?? b.createdAt) - sortTime(a.endedAt ?? a.createdAt));
  return { live, upcoming, past };
}

function sortTime(iso: string) {
  return new Date(iso).getTime();
}

export type ListingState = "open" | "ready" | "held" | "sold";

/** How a catalogue item reads in Your listings. */
export function listingState(item: Pick<ItemWithCounts, "status" | "unitsLeft" | "paid" | "quantity">): ListingState {
  if (item.status === "open") return "open";
  if (item.unitsLeft > 0) return "ready";
  if (item.paid >= item.quantity) return "sold";
  return "held";
}

/** Next code in the shop's most common prefix: S1, S2, or K7 then K8. */
export function suggestCode(codes: string[]): string {
  const used = new Set(codes);
  const prefixes = new Map<string, number>();
  for (const code of codes) {
    const m = /^([A-Z]*)(\d+)$/.exec(code);
    if (m) prefixes.set(m[1]!, Math.max(prefixes.get(m[1]!) ?? 0, Number(m[2])));
  }
  const [prefix, max] = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["S", 0];
  let n = max + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix || "S"}${n}`;
}

/** Move one entry of a list to another index. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}
