import { createContext, useContext } from "react";

import type { Schemas } from "~/lib/api";

export type Seller = Schemas["Seller"];
export type StaffRole = Schemas["StaffRole"];

export interface ShopContextValue {
  shop: Seller;
  role: StaffRole;
  staff: Schemas["Staff"];
  shops: Schemas["ShopMembership"][];
  /** Whether the server has a Nexconn App Key (live chat) or runs in preview mode. */
  chatLive: boolean;
  switchShop: (id: string) => void;
}

export const ShopContext = createContext<ShopContextValue | null>(null);

/** The shop the studio is showing. Only valid inside the /studio layout. */
export function useShop(): ShopContextValue {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShop must be used inside the studio layout");
  return value;
}

const STORAGE_KEY = "pehle.studio.shop";

export function rememberedShopId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberShopId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}
