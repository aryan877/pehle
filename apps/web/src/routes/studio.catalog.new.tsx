import { createFileRoute } from "@tanstack/react-router";

import { ItemEditor } from "~/components/studio/item-editor";
import { useItems } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { PageSpinner } from "~/components/ui";

export const Route = createFileRoute("/studio/catalog/new")({
  component: NewItemPage,
});

function NewItemPage() {
  const { shop } = useShop();
  const items = useItems(shop.id);
  if (items.isPending) return <PageSpinner />;
  return <ItemEditor key={shop.id} item={null} items={items.data ?? []} />;
}
