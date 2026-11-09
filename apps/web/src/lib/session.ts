import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, keys, unwrap, type SessionInfo } from "./api";
import { resetChat } from "./chat";

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: () => unwrap(api.GET("/api/v1/session")), staleTime: 60_000 });
}

export function buyerOf(session: SessionInfo | undefined) {
  return session?.me.kind === "buyer" ? session.me.buyer : null;
}

export function staffOf(session: SessionInfo | undefined) {
  return session?.me.kind === "staff" ? { staff: session.me.staff, shops: session.me.shops } : null;
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return async () => {
    await unwrap(api.POST("/api/v1/session/logout"));
    await resetChat();
    queryClient.clear();
  };
}

/** Room state as written by `app.live_snapshot` (camelCase JSON). */
export interface ItemState {
  id: string;
  code: string;
  title: string;
  pricePaise: number;
  imagePath: string | null;
  quantity: number;
  status: "ready" | "open" | "closed";
  held: number;
  paid: number;
  left: number;
  waitlist: number;
}

export interface Snapshot {
  status: "draft" | "live" | "ended";
  title: string;
  streamUrl: string | null;
  pinned: ItemState | null;
  open: ItemState[];
  claims: number;
  at: number;
}
