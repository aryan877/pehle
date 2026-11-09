import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "~/components/shell";
import { StudioSidebar, StudioTabs } from "~/components/studio/nav";
import { ShopContext, rememberShopId, rememberedShopId, useShop, type ShopContextValue } from "~/components/studio/shop-context";
import { CreateShop, StudioSignIn } from "~/components/studio/sign-in";
import { PageSpinner, useToast } from "~/components/ui";
import { staffOf, useSession, useSignOut } from "~/lib/session";

export const Route = createFileRoute("/studio")({
  component: StudioLayout,
});

function StudioLayout() {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const toast = useToast();
  const staff = staffOf(session.data);
  const [shopId, setShopId] = useState<string | null>(() => rememberedShopId());

  const membership = useMemo(() => {
    if (!staff?.shops.length) return null;
    return staff.shops.find((s) => s.seller.id === shopId) ?? staff.shops[0]!;
  }, [staff, shopId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") === "cancelled") toast("Sign-in was cancelled.", "info");
  }, [toast]);

  const handleSignOut = async () => {
    await signOut();
    await navigate({ to: "/studio" });
  };

  if (session.isPending) {
    return (
      <AppShell>
        <PageSpinner />
      </AppShell>
    );
  }
  if (session.isError || !session.data) {
    return (
      <AppShell>
        <div className="p-10 text-center text-fg-2">Couldn't reach Pehle. Check your connection and refresh.</div>
      </AppShell>
    );
  }
  if (!staff) return <StudioSignIn session={session.data} />;
  if (!membership) return <CreateShop staffName={staff.staff.displayName} onSignOut={handleSignOut} />;

  const value: ShopContextValue = {
    shop: membership.seller,
    role: membership.role,
    staff: staff.staff,
    shops: staff.shops,
    chatLive: session.data.chatLive,
    switchShop: (id) => {
      rememberShopId(id);
      setShopId(id);
    },
  };

  return (
    <ShopContext.Provider value={value}>
      <StudioShell onSignOut={handleSignOut} />
    </ShopContext.Provider>
  );
}

/** Create and edit pages take over the sidebar like Marketplace's create flow; the console gets the full width. */
const FOCUSED = /^\/studio\/(catalog\/[^/]+|drops\/[^/]+)\/?$/;

function StudioShell({ onSignOut }: { onSignOut: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path.startsWith("/studio/live/")) {
    return (
      <AppShell bare>
        <div className="px-3 pt-3 sm:px-5 sm:pt-4">
          <Outlet />
        </div>
      </AppShell>
    );
  }
  if (FOCUSED.test(path)) {
    return (
      <AppShell bare>
        <Outlet />
      </AppShell>
    );
  }
  return (
    <AppShell sidebar={<StudioSidebar onSignOut={onSignOut} />}>
      <StudioTabs onSignOut={onSignOut} />
      <div className="mx-auto w-full max-w-[1280px] xl:pt-1">
        <PracticeBanner />
        <Outlet />
      </div>
    </AppShell>
  );
}

/** Practice shops explain how to race yourself, since only practice buyers can claim there. */
function PracticeBanner() {
  const { shop } = useShop();
  if (!shop.isDemo) return null;
  return (
    <p className="mb-4 rounded-xl bg-gold-soft px-4 py-3 text-[14px] text-fg shadow-surface">
      <b className="text-gold">Practice shop.</b> Start a drop, then open its link in a private window and tap Claim to race yourself.
      Payments are simulated and nothing here appears on the home page.
    </p>
  );
}
