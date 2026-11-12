import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { Inbox } from "~/components/inbox";
import { useShop } from "~/components/studio/shop-context";
import { errorMessage } from "~/components/ui";
import { api, keys, unwrap } from "~/lib/api";

interface StudioInboxSearch {
  /** The conversation shown in the thread pane. */
  c?: string;
}

export const Route = createFileRoute("/studio/inbox")({
  validateSearch: (search: Record<string, unknown>): StudioInboxSearch => ({
    c: typeof search.c === "string" && search.c ? search.c : undefined,
  }),
  component: StudioInbox,
});

/** The shop team's inbox: every buyer conversation, with that buyer's orders beside the thread. */
function StudioInbox() {
  const { shop, staff, chatLive } = useShop();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conversations = useQuery({
    queryKey: keys.shopConversations(shop.id),
    queryFn: () => unwrap(api.GET("/api/v1/shops/{shop_id}/conversations", { params: { path: { shop_id: shop.id } } })),
    refetchInterval: chatLive ? 30_000 : 15_000,
  });
  const select = useCallback((id: string | null) => void navigate({ to: "/studio/inbox", search: id ? { c: id } : {}, replace: !id }), [navigate]);
  return (
    <Inbox
      side="seller"
      conversations={conversations.data}
      loading={conversations.isPending}
      error={conversations.isError ? errorMessage(conversations.error) : null}
      selectedId={search.c ?? null}
      onSelect={select}
      me={{ userId: staff.nexconnUserId, name: staff.displayName }}
      chatLive={chatLive}
      onUnknownChannel={() => void queryClient.invalidateQueries({ queryKey: keys.shopConversations(shop.id) })}
      frameClassName="-mx-3 -mt-4 sm:-mx-5 md:fixed md:inset-x-0 md:bottom-0 md:top-[161px] md:z-20 md:m-0 xl:left-[360px] xl:top-14"
      ordersQuery={(c) => ({
        queryKey: keys.buyerOrders(shop.id, c.buyerId),
        queryFn: () =>
          unwrap(api.GET("/api/v1/shops/{shop_id}/buyers/{buyer_id}/orders", { params: { path: { shop_id: shop.id, buyer_id: c.buyerId } } })),
        refetchInterval: 15_000,
      })}
      empty={
        <div className="text-center">
          <p className="text-[15px] font-semibold">No buyer chats yet</p>
          <p className="mt-1 text-[14px] text-muted">
            When a buyer taps Message shop, or wins a claim in one of your drops, the conversation starts here with their order.
          </p>
        </div>
      }
    />
  );
}
