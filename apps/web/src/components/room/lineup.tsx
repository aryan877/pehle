import { CheckCircle2, Hourglass } from "lucide-react";

import { Button, CodeChip, cx } from "~/components/ui";
import type { PublicItem } from "~/lib/api";
import { mediaUrl } from "~/lib/format";

import { myClaimFor, type RoomModel } from "./model";
import { priceLabel } from "./shop";

function quantityText(item: PublicItem, ended: boolean) {
  if (item.status === "closed") return item.unitsLeft === 0 ? "Gone" : "Closed";
  if (ended && item.status === "ready") return "Not dropped this time";
  return item.quantity === 1 ? "1 piece" : `${item.quantity} pieces`;
}

/**
 * The rest of the drop: other items open right now (claim them by code) and what the seller will
 * drop next, from the announced lineup.
 */
export function UpNext({ model, glass, className }: { model: RoomModel; glass?: boolean; className?: string }) {
  const pinnedId = model.pinned?.id;
  const openOthers = model.open.filter((i) => i.id !== pinnedId);
  const openIds = new Set(model.open.map((i) => i.id));
  const coming = model.lineup.filter((i) => i.status === "ready" && !openIds.has(i.id) && i.id !== pinnedId);
  if (!openOthers.length && !coming.length) return null;
  return (
    <section className={className} aria-label="Up next">
      <h2 className={cx("mb-2 text-[15px] font-bold", glass ? "text-white" : "text-fg")}>
        {openOthers.length ? "Also open, and up next" : "Up next"}
      </h2>
      <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {openOthers.map((i) => {
          const mine = myClaimFor(model, i.id);
          return (
            <li
              key={i.id}
              className={cx(
                "flex w-60 shrink-0 items-center gap-2.5 rounded-xl p-2",
                glass ? "bg-black/55 backdrop-blur" : "bg-surface shadow-surface",
              )}
            >
              <Thumb path={i.photos[0]} code={i.code} />
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-[13px] font-semibold", glass && "text-white")}>{i.title}</p>
                <p className="text-[13px] font-bold text-gold">{priceLabel(i.pricePaise)}</p>
                {mine ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-good">
                    {mine.status === "waitlisted" ? <Hourglass className="size-3.5 text-gold" /> : <CheckCircle2 className="size-3.5" />}
                    {mine.status === "waitlisted" ? `You're #${mine.position} in line` : "Yours"}
                  </p>
                ) : (
                  <Button
                    size="sm"
                    className="mt-1 h-7 px-2.5 text-[12px]"
                    loading={model.claim.pendingCode === i.code}
                    disabled={Boolean(model.claim.pendingCode) || model.status !== "live"}
                    onClick={() => void model.claim.claim(i.code)}
                  >
                    {i.left === 0 ? "Join the line" : `Claim ${i.code}`}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        {coming.map((i) => (
          <li
            key={i.id}
            className={cx(
              "flex w-56 shrink-0 items-center gap-2.5 rounded-xl p-2",
              glass ? "bg-black/45 backdrop-blur" : "bg-surface/60 shadow-surface",
            )}
          >
            <Thumb path={i.imagePath} code={i.code} />
            <div className="min-w-0 flex-1">
              <p className={cx("truncate text-[13px] font-semibold", glass ? "text-white" : "text-fg")}>{i.title}</p>
              <p className="text-[13px] font-bold text-fg-2">{priceLabel(i.pricePaise)}</p>
              <p className={cx("text-[12px]", glass ? "text-white/60" : "text-muted")}>Coming up</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Thumb({ path, code }: { path?: string | null; code: string }) {
  const src = mediaUrl(path);
  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-surface-3">
      {src ? <img src={src} alt="" className="size-full object-cover" loading="lazy" /> : null}
      <CodeChip code={code} className="absolute bottom-0.5 left-0.5 px-1 text-[10px]" />
    </span>
  );
}

/** Marketplace grid for the announced lineup: photo, price first, then title and quantity. */
export function LineupGrid({ items, className, ended = false }: { items: PublicItem[]; className?: string; ended?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cx("grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4", className)}>
      {items.map((i) => {
        const src = mediaUrl(i.imagePath);
        return (
          <li key={i.id} className="min-w-0">
            <div className="tile aspect-square">
              {src ? <img src={src} alt={i.title} loading="lazy" className="size-full object-cover" /> : null}
              <CodeChip code={i.code} className="absolute left-2 top-2" />
              {i.galleryPaths.length ? (
                <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 text-[11px] font-semibold text-white">
                  {i.galleryPaths.length + 1} photos
                </span>
              ) : null}
            </div>
            <p className={cx("mt-1.5 text-[17px] font-bold leading-tight", i.pricePaise === 0 && "text-good")}>{priceLabel(i.pricePaise)}</p>
            <p className="truncate text-[15px] leading-snug">{i.title}</p>
            <p className="text-[13px] text-muted">{quantityText(i, ended)}</p>
          </li>
        );
      })}
    </ul>
  );
}
