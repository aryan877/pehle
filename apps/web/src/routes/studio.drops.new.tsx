import { createFileRoute } from "@tanstack/react-router";

import { DropEditor } from "~/components/studio/drop-editor";
import { useItems } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { PageSpinner } from "~/components/ui";

export const Route = createFileRoute("/studio/drops/new")({
  component: NewDropPage,
});

function NewDropPage() {
  const { shop } = useShop();
  const items = useItems(shop.id);
  if (items.isPending) return <PageSpinner />;
  return <DropEditor key={shop.id} live={null} lineup={[]} items={items.data ?? []} roomUrl={null} />;
}
