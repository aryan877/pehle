import { createPehleClient, unwrap, type Schemas } from "@pehle/api-client";

export const api = createPehleClient();
export { unwrap };
export type { Schemas };

export type SessionInfo = Schemas["SessionInfo"];
export type Me = Schemas["Me"];
export type RoomView = Schemas["RoomView"];
export type ClaimResult = Schemas["ClaimResult"];
export type QueueEntry = Schemas["QueueEntry"];
export type Checkout = Schemas["Checkout"];
export type OrderView = Schemas["OrderView"];
export type Seller = Schemas["Seller"];
export type Item = Schemas["Item"];
export type ItemWithCounts = Schemas["ItemWithCounts"];
export type Live = Schemas["Live"];
export type LiveConsole = Schemas["LiveConsole"];
export type Approval = Schemas["Approval"];
export type Stats = Schemas["Stats"];
export type FairnessLog = Schemas["FairnessLog"];
export type PublicItem = Schemas["PublicItem"];
export type BrowseFeed = Schemas["BrowseFeed"];
export type DropCard = Schemas["DropCard"];
export type PickCard = Schemas["PickCard"];
export type ShopPage = Schemas["ShopPage"];
export type TrustRecord = Schemas["TrustRecord"];
export type ShopItem = Schemas["ShopItem"];
export type Conversation = Schemas["Conversation"];
export type DropReport = Schemas["DropReport"];
export type DemoRace = Schemas["DemoRace"];
export type PublicShop = Schemas["PublicShop"];

/** Query keys in one place so invalidation stays consistent. */
export const keys = {
  session: ["session"] as const,
  room: (slug: string) => ["room", slug] as const,
  order: (id: string) => ["order", id] as const,
  myOrders: ["orders", "mine"] as const,
  shop: (id: string) => ["shop", id] as const,
  items: (shopId: string) => ["shop", shopId, "items"] as const,
  lives: (shopId: string) => ["shop", shopId, "lives"] as const,
  console: (liveId: string) => ["live", liveId, "console"] as const,
  shopOrders: (shopId: string, filter: string) => ["shop", shopId, "orders", filter] as const,
  approvals: (shopId: string) => ["shop", shopId, "approvals"] as const,
  shopStats: (shopId: string) => ["shop", shopId, "stats"] as const,
  stats: ["stats"] as const,
  fairness: (slug: string) => ["fairness", slug] as const,
  browse: (category: string | undefined, q: string | undefined) => ["browse", category ?? "", q ?? ""] as const,
  shopPage: (handle: string) => ["shop-page", handle] as const,
  conversations: ["conversations", "mine"] as const,
  shopConversations: (shopId: string) => ["shop", shopId, "conversations"] as const,
  ordersWithShop: (handle: string) => ["orders", "shop", handle] as const,
  buyerOrders: (shopId: string, buyerId: string) => ["shop", shopId, "buyer", buyerId, "orders"] as const,
  lineup: (liveId: string) => ["live", liveId, "lineup"] as const,
  report: (liveId: string) => ["live", liveId, "report"] as const,
};

/** Upload a product photo after shrinking it in the browser (long edge 1600px, WebP). */
export async function uploadPhoto(file: File): Promise<{ path: string; url: string }> {
  const blob = await shrink(file, 1600);
  const form = new FormData();
  form.append("file", blob, "photo.webp");
  const response = await fetch("/api/v1/media", {
    method: "POST",
    body: form,
    credentials: "include",
    headers: { "X-Pehle": "1" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Upload failed");
  }
  return response.json();
}

async function shrink(file: File, longEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/webp", 0.86));
}
