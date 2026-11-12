import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageCircle, Store } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Inbox } from "~/components/inbox";
import { AppShell } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Button, PageSpinner, Spinner, errorMessage } from "~/components/ui";
import { api, keys, unwrap, type Conversation } from "~/lib/api";
import { buyerOf, staffOf, useSession } from "~/lib/session";

interface InboxSearch {
  /** Open (or start) the conversation with this shop handle. */
  shop?: string;
  /** The conversation shown in the thread pane. */
  c?: string;
}

export const Route = createFileRoute("/inbox")({
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    shop: typeof search.shop === "string" && search.shop ? search.shop : undefined,
    c: typeof search.c === "string" && search.c ? search.c : undefined,
  }),
  component: Page,
});

function Page() {
  const session = useSession();
  const buyer = buyerOf(session.data);
  const staff = staffOf(session.data);
  const search = Route.useSearch();
  const signIn = useSignIn();

  if (session.isPending) {
    return (
      <AppShell>
        <PageSpinner />
      </AppShell>
    );
  }
  if (staff) {
    return (
      <AppShell>
        <Centered icon={<Store className="size-6" />} title="You're signed in as a shop">
          Buyers' messages to your shop are in the studio inbox.
          <div className="mt-4">
            <Link
              to="/studio/inbox"
              className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-[15px] font-semibold text-white hover:bg-accent-hover"
            >
              Open the shop inbox
            </Link>
          </div>
        </Centered>
      </AppShell>
    );
  }
  if (!buyer) {
    return (
      <AppShell>
        <Centered icon={<MessageCircle className="size-6" />} title={search.shop ? "Sign in to message the shop" : "Your chats with shops"}>
          Ask about sizes or shipping, and keep every order you win next to the conversation.
          <div className="mt-4">
            <Button
              onClick={() =>
                signIn({
                  title: "Sign in to message shops",
                  reason: "Shops see your first name and initial. Your phone and address are shared only for orders you win.",
                })
              }
            >
              Sign in
            </Button>
          </div>
        </Centered>
      </AppShell>
    );
  }
  return <BuyerInbox chatLive={session.data?.chatLive ?? false} me={{ userId: buyer.nexconnUserId, name: buyer.displayName }} />;
}

function Centered({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-fg-2" aria-hidden>
        {icon}
      </span>
      <h1 className="mt-4 font-display text-[24px] font-bold">{title}</h1>
      <div className="mt-1 text-[15px] text-fg-2">{children}</div>
    </div>
  );
}

function BuyerInbox({ chatLive, me }: { chatLive: boolean; me: { userId: string; name: string } }) {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const conversations = useQuery({
    queryKey: keys.conversations,
    queryFn: () => unwrap(api.GET("/api/v1/conversations")),
    refetchInterval: chatLive ? 30_000 : 15_000,
  });

  const select = useCallback((id: string | null) => void navigate({ to: "/inbox", search: id ? { c: id } : {}, replace: !id }), [navigate]);

  // `/inbox?shop=handle` (the room's Message shop button): open or create that conversation.
  const open = useMutation({
    mutationFn: (handle: string) => unwrap(api.POST("/api/v1/shops/by-handle/{handle}/conversation", { params: { path: { handle } } })),
    onSuccess: (c) => {
      queryClient.setQueryData<Conversation[]>(keys.conversations, (list) => [c, ...(list ?? []).filter((x) => x.id !== c.id)]);
      void navigate({ to: "/inbox", search: { c: c.id }, replace: true });
    },
  });
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!search.shop || openedFor.current === search.shop) return;
    openedFor.current = search.shop;
    open.mutate(search.shop);
  }, [search.shop, open]);

  const banner = open.isPending ? (
    <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2" role="status">
      <Spinner className="size-4" /> Opening your chat with the shop
    </p>
  ) : open.isError ? (
    <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent" role="alert">
      {errorMessage(open.error)}
    </p>
  ) : null;

  return (
    <AppShell bare>
      <Inbox
        side="buyer"
        conversations={conversations.data}
        loading={conversations.isPending}
        error={conversations.isError ? errorMessage(conversations.error) : null}
        selectedId={search.c ?? null}
        onSelect={select}
        me={me}
        chatLive={chatLive}
        banner={banner}
        onUnknownChannel={() => void queryClient.invalidateQueries({ queryKey: keys.conversations })}
        frameClassName="md:fixed md:inset-x-0 md:bottom-0 md:top-14"
        ordersQuery={(c) => ({
          queryKey: keys.ordersWithShop(c.shopHandle),
          queryFn: () => unwrap(api.GET("/api/v1/shops/by-handle/{handle}/orders", { params: { path: { handle: c.shopHandle } } })),
          refetchInterval: 15_000,
        })}
        empty={
          <div className="text-center">
            <p className="text-[15px] font-semibold">No chats yet</p>
            <p className="mt-1 text-[14px] text-muted">Tap Message shop in any drop to ask a question. Orders you win show up here too.</p>
            <Link to="/live" className="mt-3 inline-flex h-9 items-center rounded-lg bg-white/10 px-4 text-[15px] font-semibold hover:bg-white/15">
              See who is live
            </Link>
          </div>
        }
      />
    </AppShell>
  );
}
