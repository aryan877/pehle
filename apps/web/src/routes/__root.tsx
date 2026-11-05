import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { SignInProvider } from "~/components/sign-in";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <SignInProvider>
      <Outlet />
    </SignInProvider>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-5xl font-bold text-accent">404</p>
      <p className="text-lg text-fg-2">This page does not exist, or the drop has moved.</p>
      <Link to="/" className="font-semibold text-accent underline-offset-4 hover:underline">
        Go to Pehle
      </Link>
    </div>
  );
}
