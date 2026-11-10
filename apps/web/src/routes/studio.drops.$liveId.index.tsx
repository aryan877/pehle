import { Link, createFileRoute } from "@tanstack/react-router";

import { DropEditor } from "~/components/studio/drop-editor";
import { useConsole, useItems, useLineup } from "~/components/studio/queries";
import { useShop } from "~/components/studio/shop-context";
import { Button, Empty, PageSpinner, errorMessage } from "~/components/ui";

export const Route = createFileRoute("/studio/drops/$liveId/")({
  component: EditDropPage,
});

function EditDropPage() {
  const { liveId } = Route.useParams();
  const { shop } = useShop();
  const drop = useConsole(liveId, 30_000);
  const lineup = useLineup(liveId);
  const items = useItems(shop.id);

  if (drop.isPending || lineup.isPending || items.isPending) return <PageSpinner />;
  if (drop.isError || !drop.data) {
    return (
      <div className="p-5">
        <Empty
          title="Couldn't open this drop"
          action={
            <Link to="/studio/drops">
              <Button variant="secondary">Back to drops</Button>
            </Link>
          }
        >
          {drop.error ? errorMessage(drop.error) : null}
        </Empty>
      </div>
    );
  }
  // Keyed on the saved version so a save elsewhere (or switching drops) refreshes the form.
  return (
    <DropEditor
      key={drop.data.live.id}
      live={drop.data.live}
      lineup={lineup.data ?? []}
      items={items.data ?? drop.data.items}
      roomUrl={drop.data.roomUrl}
    />
  );
}
