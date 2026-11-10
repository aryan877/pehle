import { Link, createFileRoute } from "@tanstack/react-router";

import { ItemEditor } from "~/components/studio/item-editor";
import { useItems } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { Button, Empty, PageSpinner, errorMessage } from "~/components/ui";

export const Route = createFileRoute("/studio/catalog/$itemId")({
  component: EditItemPage,
});

function EditItemPage() {
  const { itemId } = Route.useParams();
  const { shop } = useShop();
  const items = useItems(shop.id);
  if (items.isPending) return <PageSpinner />;
  const item = items.data?.find((i) => i.id === itemId);
  if (!item) {
    return (
      <div className="p-5">
        <Empty
          title={items.isError ? "Couldn't load this item" : "This item isn't in your catalogue"}
          action={
            <Link to="/studio/catalog">
              <Button variant="secondary">Back to catalogue</Button>
            </Link>
          }
        >
          {items.isError ? errorMessage(items.error) : "It may have been removed, or it belongs to another shop."}
        </Empty>
      </div>
    );
  }
  // Re-mount when switching items so the form starts from the saved values.
  return <ItemEditor key={item.id} item={item} items={items.data ?? []} />;
}
