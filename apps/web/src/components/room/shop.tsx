import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, MapPin, MessageCircle, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AlertsPrompt } from "~/components/alerts";
import { categoryLabel } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Avatar, Button, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type RoomView } from "~/lib/api";
import { mediaUrl, rupees } from "~/lib/format";

/** "Free" for giveaways, otherwise the price in Indian format. */
export function priceLabel(pricePaise: number): string {
  return pricePaise === 0 ? "Free" : rupees(pricePaise);
}

/** Link to the shop's public page. */
export function ShopLink({
  handle,
  className,
  children,
  ...rest
}: {
  handle: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Link to="/s/$handle" params={{ handle }} className={className} {...rest}>
      {children}
    </Link>
  );
}

/**
 * Join the shop's club (follow): club members hear first when the shop goes live. After joining,
 * offers browser alerts so that "hear first" can reach a closed tab.
 */
export function JoinClubButton({
  room,
  size = "sm",
  className,
  onJoined,
  tone = "primary",
}: {
  room: RoomView;
  size?: "sm" | "md";
  className?: string;
  onJoined?: () => void;
  tone?: "primary" | "glass";
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const join = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/shops/by-handle/{handle}/follow", { params: { path: { handle: room.shop.handle } } })),
    onSuccess: () => {
      toast(`You're in ${room.shop.displayName}'s club.`, "success");
      void queryClient.invalidateQueries({ queryKey: keys.room(room.live.slug) });
      onJoined?.();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const glass = tone === "glass";
  if (room.following) {
    return (
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md font-semibold",
          size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-[14px]",
          glass ? "bg-black/45 text-white backdrop-blur" : "bg-white/10 text-fg",
          className,
        )}
      >
        <BadgeCheck className="size-4 text-accent" aria-hidden /> In the club
      </span>
    );
  }
  return (
    <Button
      size={size}
      variant={glass ? "secondary" : "primary"}
      loading={join.isPending}
      className={cx(glass && "bg-white/20 text-white backdrop-blur hover:bg-white/30", className)}
      onClick={() => join.mutate()}
    >
      <Users className="size-4" aria-hidden /> Join club
    </Button>
  );
}

/** A Join club button that asks signed-out visitors to sign in first. */
export function ClubAction({
  room,
  signedIn,
  size,
  className,
  tone,
  withAlerts,
}: {
  room: RoomView;
  signedIn: boolean;
  size?: "sm" | "md";
  className?: string;
  tone?: "primary" | "glass";
  /** Offer browser alerts under the button once the visitor has joined. */
  withAlerts?: boolean;
}) {
  const signIn = useSignIn();
  const [joinedNow, setJoinedNow] = useState(false);
  if (!signedIn) {
    return (
      <Button
        size={size ?? "sm"}
        variant={tone === "glass" ? "secondary" : "primary"}
        className={cx(tone === "glass" && "bg-white/20 text-white backdrop-blur hover:bg-white/30", className)}
        onClick={() =>
          signIn({
            title: "Sign in to join the club",
            reason: `Club members hear first when ${room.shop.displayName} goes live or drops something new.`,
          })
        }
      >
        <Users className="size-4" aria-hidden /> Join club
      </Button>
    );
  }
  return (
    <>
      <JoinClubButton room={room} size={size} className={className} tone={tone} onJoined={() => setJoinedNow(true)} />
      {withAlerts && joinedNow ? <AlertsPrompt className="order-last mt-1 basis-full" title={`Hear when ${room.shop.displayName} goes live`} /> : null}
    </>
  );
}

/** Opens (or creates) the private conversation with the shop. */
export function MessageShopButton({ handle, compact, className }: { handle: string; compact?: boolean; className?: string }) {
  return (
    <Link
      to="/inbox"
      search={{ shop: handle }}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md bg-white/10 font-semibold text-fg transition hover:bg-white/15",
        compact ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-[14px]",
        className,
      )}
    >
      <MessageCircle className="size-4" aria-hidden /> Message shop
    </Link>
  );
}

/** The shop, who they are and how to keep up with them. */
export function ShopCard({ room, signedIn, className }: { room: RoomView; signedIn: boolean; className?: string }) {
  const shop = room.shop;
  return (
    <section className={cx("rounded-xl bg-surface p-4 shadow-surface", className)} aria-label="About the shop">
      <div className="flex items-start gap-3">
        <Avatar name={shop.displayName} src={mediaUrl(shop.avatarPath)} size={56} />
        <div className="min-w-0 flex-1">
          <ShopLink handle={shop.handle} className="block truncate text-[17px] font-bold hover:underline">
            {shop.displayName}
          </ShopLink>
          {shop.tagline ? <p className="mt-0.5 line-clamp-2 text-[14px] text-fg-2">{shop.tagline}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>{categoryLabel(shop.category)}</span>
            {shop.city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {shop.city}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ClubAction room={room} signedIn={signedIn} size="md" withAlerts />
        <MessageShopButton handle={shop.handle} />
        <ShopLink
          handle={shop.handle}
          className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-[14px] font-semibold text-fg-2 hover:bg-white/10 hover:text-fg"
        >
          See the shop <ArrowRight className="size-4" aria-hidden />
        </ShopLink>
      </div>
    </section>
  );
}
