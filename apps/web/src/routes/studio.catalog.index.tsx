import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PhotoTile } from "~/components/shell";
import { ListingOverlay, PageHeader, Segmented, priceLabel } from "~/components/studio/bits";
import { listingState, useItems, type ListingState } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { Button, CodeChip, Empty, PageSpinner, errorMessage } from "~/components/ui";
import type { ItemWithCounts } from "~/lib/api";

export const Route = createFileRoute("/studio/catalog/")({
  component: CatalogPage,
});

type Filter = "all" | "ready" | "open" | "out";

const matches: Record<Filter, (s: ListingState) => boolean> = {
  all: () => true,
  ready: (s) => s === "ready",
  open: (s) => s === "open",
  out: (s) => s === "sold" || s === "held",
};

function CatalogPage() {
  const { shop } = useShop();
  const items = useItems(shop.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const all = [...(items.data ?? [])].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const q = query.trim().toLowerCase();
    return all.filter((i) => matches[filter](listingState(i)) && (!q || i.code.toLowerCase().includes(q) || i.title.toLowerCase().includes(q)));
  }, [items.data, filter, query]);
  const count = (f: Filter) => (items.data ?? []).filter((i) => matches[f](listingState(i))).length;

  const addButton = (
    <Link to="/studio/catalog/new">
      <Button>
        <Plus className="size-4" /> Add item
      </Button>
    </Link>
  );

  if (items.isPending) return <PageSpinner />;
  if (items.isError) return <Empty title="Couldn't load your catalogue">{errorMessage(items.error)}</Empty>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalogue"
        subtitle={`${items.data.length} ${items.data.length === 1 ? "item" : "items"}. Each has a code you say on stream.`}
        actions={items.data.length ? addButton : null}
      />

      {items.data.length === 0 ? (
        <Empty title="Add your first item to start a drop." action={addButton} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<Filter>
              label="Filter items"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "ready", label: "Ready", count: count("ready") },
                { value: "open", label: "Open in a drop", count: count("open") },
                { value: "out", label: "Sold out", count: count("out") },
              ]}
            />
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3 text-fg-2 sm:ml-auto sm:max-w-[260px]">
              <Search className="size-4 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code or title"
                aria-label="Search your catalogue"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
              />
            </label>
          </div>

          {list.length === 0 ? (
            <p className="py-10 text-center text-fg-2">Nothing matches. Try another filter.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-2 gap-y-5 md:grid-cols-3 md:gap-x-3 lg:grid-cols-4 2xl:grid-cols-5">
              {list.map((item) => (
                <li key={item.id}>
                  <ListingTile item={item} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ListingTile({ item }: { item: ItemWithCounts }) {
  const state = listingState(item);
  const extra = [item.held ? `${item.held} on hold` : null, item.paid ? `${item.paid} sold` : null, item.waitlist ? `${item.waitlist} in line` : null].filter(Boolean);
  return (
    <Link to="/studio/catalog/$itemId" params={{ itemId: item.id }} className="group block rounded-lg focus-visible:outline-offset-4">
      <PhotoTile path={item.imagePath} alt={item.title} className="transition group-hover:brightness-110">
        <CodeChip code={item.code} className="absolute left-2 top-2" />
        {state !== "ready" ? <ListingOverlay state={state} className="absolute bottom-2 left-2" /> : null}
        {item.galleryPaths.length ? (
          <span className="absolute right-2 top-2 rounded bg-black/65 px-1.5 text-[11px] font-bold leading-5 text-white">{item.galleryPaths.length + 1} photos</span>
        ) : null}
      </PhotoTile>
      <p className="tabular mt-1.5 text-[17px] font-bold leading-snug">{priceLabel(item.pricePaise)}</p>
      <p className="truncate text-[15px] leading-snug">{item.title}</p>
      <p className="truncate text-[13px] text-fg-2">
        {item.unitsLeft} of {item.quantity} left{extra.length ? `, ${extra.join(", ")}` : ""}
      </p>
    </Link>
  );
}
