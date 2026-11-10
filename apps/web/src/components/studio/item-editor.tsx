import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Gift, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button, Field, Input, Sheet, Textarea, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type ItemWithCounts } from "~/lib/api";
import { rupees } from "~/lib/format";

import { ListingBadge, Notice, Progress, Toggle } from "./bits";
import { CreateLayout, PanelSection, PreviewFrame, PreviewLabel } from "./create-layout";
import { MAX_PHOTOS, PhotoGrid, photoPaths, photosFrom, type Photo } from "./photo-grid";
import { BrowseTilePreview, RoomItemPreview, WinnerNotePreview } from "./previews";
import { listingState, suggestCode } from "./queries";
import { useShop } from "./shop-context";

/** Create or edit one catalogue item, with a live preview of the browse tile and the room card. */
export function ItemEditor({ item, items }: { item: ItemWithCounts | null; items: ItemWithCounts[] }) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const others = useMemo(() => items.filter((i) => i.id !== item?.id), [items, item?.id]);

  const blank = () => ({
    photos: [] as Photo[],
    code: suggestCode(others.map((i) => i.code)),
    title: "",
    description: "",
    free: shop.category === "creator",
    price: "",
    quantity: "1",
    winnerNote: "",
  });
  const initial = item
    ? {
        photos: photosFrom([item.imagePath, ...item.galleryPaths]),
        code: item.code,
        title: item.title,
        description: item.description ?? "",
        free: item.pricePaise === 0,
        price: item.pricePaise ? String(item.pricePaise / 100) : "",
        quantity: String(item.quantity),
        winnerNote: item.winnerNote ?? "",
      }
    : blank();

  const [photos, setPhotos] = useState<Photo[]>(initial.photos);
  const [code, setCode] = useState(initial.code);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [free, setFree] = useState(initial.free);
  const [price, setPrice] = useState(initial.price);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [winnerNote, setWinnerNote] = useState(initial.winnerNote);
  const [noteOpen, setNoteOpen] = useState(Boolean(initial.winnerNote));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pricePaise = free ? 0 : Math.round(Number(price.replace(/,/g, "")) * 100);
  const qty = Number(quantity);
  const minQty = item ? item.held + item.paid : 1;
  const duplicate = others.find((i) => i.code === code);
  const codeError = !code ? "Give it a code you can say on stream." : !/^[A-Z0-9]{1,8}$/.test(code) ? "1 to 8 letters or digits." : duplicate ? `${code} is already ${duplicate.title}.` : null;
  const priceError = free ? null : !price ? "Add a price, or turn on Free." : !(pricePaise >= 100 && pricePaise <= 100_000_000) ? "Between ₹1 and ₹10,00,000." : null;
  const qtyError = !(Number.isInteger(qty) && qty >= 1 && qty <= 999) ? "1 to 999 pieces." : qty < minQty ? `${minQty} already held or sold.` : null;
  const titleError = !title.trim() ? "Add a title buyers will recognise." : null;
  const uploading = photos.some((p) => !p.path);
  const showNote = noteOpen || free || shop.category === "creator";

  const steps = [photos.some((p) => p.path), !codeError, !titleError, !priceError, !qtyError];
  const done = steps.filter(Boolean).length;
  const valid = !codeError && !titleError && !priceError && !qtyError;

  const reset = (savedCode: string) => {
    const next = blank();
    setPhotos([]);
    setCode(suggestCode([...others.map((i) => i.code), savedCode]));
    setTitle("");
    setDescription("");
    setFree(next.free);
    setPrice("");
    setQuantity("1");
    setWinnerNote("");
    setNoteOpen(false);
    setTried(false);
    window.scrollTo({ top: 0 });
  };

  const body = () => ({
    code,
    title: title.trim(),
    description: description.trim() || null,
    pricePaise,
    quantity: qty,
    ...photoPaths(photos),
    winnerNote: showNote ? winnerNote.trim() || null : null,
  });

  const save = useMutation({
    mutationFn: (_addAnother: boolean) =>
      item
        ? unwrap(api.PUT("/api/v1/shops/{shop_id}/items/{item_id}", { params: { path: { shop_id: shop.id, item_id: item.id } }, body: body() }))
        : unwrap(api.POST("/api/v1/shops/{shop_id}/items", { params: { path: { shop_id: shop.id } }, body: body() })),
    onSuccess: async (saved, addAnother) => {
      await queryClient.invalidateQueries({ queryKey: keys.items(shop.id) });
      if (addAnother && !item) {
        toast(`Added ${saved.code}. Next one.`, "success");
        reset(saved.code);
        return;
      }
      toast(item ? `Saved ${saved.code}.` : `Added ${saved.code} to your catalogue.`, "success");
      await navigate({ to: "/studio/catalog" });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/shops/{shop_id}/items/{item_id}", { params: { path: { shop_id: shop.id, item_id: item!.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.items(shop.id) });
      toast(`Removed ${item?.code}.`, "info");
      await navigate({ to: "/studio/catalog" });
    },
    onError: (e) => {
      setConfirmRemove(false);
      setError(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setTried(true);
    setError(null);
    if (valid && !uploading) save.mutate(submitter?.value === "another");
  };

  const show = (message: string | null) => (tried ? message : null);
  const another = save.variables === true;
  const cover = photos[0]?.src ?? null;
  const place = [shop.displayName, shop.city].filter(Boolean).join(", ");

  return (
    <CreateLayout
      crumb="Studio, Catalogue"
      title={item ? `Edit ${item.code}` : "New listing"}
      closeTo="/studio/catalog"
      onSubmit={submit}
      panel={
        <>
          {item?.status === "open" ? <Notice tone="warn">{item.code} is open in a drop right now. Changes show in the room straight away.</Notice> : null}
          <PanelSection title="Photos" hint={`A clear photo on a plain background sells best. Up to ${MAX_PHOTOS}.`}>
            <PhotoGrid photos={photos} setPhotos={setPhotos} />
          </PanelSection>

          <PanelSection title="Details">
            <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
              <Field label="Code" htmlFor="item-code" error={show(codeError)}>
                <Input
                  id="item-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                  className="font-mono font-bold tracking-wide"
                  autoCapitalize="characters"
                  autoComplete="off"
                  aria-describedby="code-help"
                />
              </Field>
              <Field label="Title" htmlFor="item-title" error={show(titleError)}>
                <Input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Banarasi silk, rani pink" />
              </Field>
            </div>
            <p id="code-help" className="-mt-1 text-[13px] text-muted">
              Say the code on stream. Buyers type it, or just “mine”, to claim.
            </p>

            <Toggle
              id="item-free"
              checked={free}
              onChange={setFree}
              label="Free"
              hint={free ? "First to claim wins it. There's no payment step." : "Turn on for giveaways, samples and coupon drops."}
            />
            <div className={cx("grid gap-3", free ? "grid-cols-1" : "grid-cols-2")}>
              {!free ? (
                <Field label="Price" htmlFor="item-price" error={show(priceError)} hint={!priceError && price ? `Buyers see ${rupees(pricePaise)}` : undefined}>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-2">₹</span>
                    <Input
                      id="item-price"
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^0-9.,]/g, ""))}
                      placeholder="4500"
                      className="pl-8"
                    />
                  </div>
                </Field>
              ) : null}
              <Field label="Pieces" htmlFor="item-qty" error={show(qtyError) ?? (item && qty < minQty ? qtyError : null)}>
                <Input id="item-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              </Field>
            </div>
            <Field label="Description (optional)" htmlFor="item-desc" hint="Fabric, size, length, care. The co-host uses this to answer questions in chat.">
              <Textarea id="item-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className="min-h-24" placeholder="Pure silk, 6.3 m with blouse piece, zari border." />
            </Field>
          </PanelSection>

          {showNote ? (
            <PanelSection title="Winner note" hint="Revealed only to people who win this, for example a coupon code.">
              <Textarea
                id="item-note"
                aria-label="Winner note"
                value={winnerNote}
                onChange={(e) => setWinnerNote(e.target.value)}
                maxLength={500}
                className="min-h-20"
                placeholder={free ? "Your code: DEV50. Use it at checkout before Sunday." : "Thank you! Your piece ships within 2 days."}
              />
              <p className="-mt-1 text-right text-[12px] text-muted">{winnerNote.length} of 500</p>
            </PanelSection>
          ) : (
            <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-2 text-[14px] font-semibold text-fg-2 hover:text-fg">
              <Gift className="size-4" /> Add a private note for the winner
            </button>
          )}

          {error ? <Notice tone="error">{error}</Notice> : null}

          {item ? (
            <div className="border-t border-line pt-4">
              <Button
                type="button"
                variant="ghost"
                className="text-accent"
                onClick={() => setConfirmRemove(true)}
                disabled={item.status === "open"}
              >
                <Trash2 className="size-4" /> Remove from catalogue
              </Button>
              {item.status === "open" ? <p className="mt-1 text-[13px] text-muted">Close it in the live console before removing it.</p> : null}
            </div>
          ) : null}

          {item ? (
            <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${item.code}?`}>
              <div className="space-y-4">
                <p className="text-fg-2">It leaves your catalogue and any upcoming lineups. Past orders and reports keep it.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" block onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </Button>
                  <Button block loading={remove.isPending} onClick={() => remove.mutate()}>
                    Remove
                  </Button>
                </div>
              </div>
            </Sheet>
          ) : null}
        </>
      }
      footer={
        <div className="space-y-3">
          <Progress done={done} total={steps.length} label={uploading ? "Uploading photos" : done === steps.length ? "Ready to save" : `${done} of ${steps.length} done`} />
          <div className="flex gap-2">
            {!item ? (
              <Button type="submit" value="another" variant="secondary" block loading={save.isPending && another} disabled={uploading || (save.isPending && !another)}>
                Save, add another
              </Button>
            ) : null}
            <Button type="submit" value="done" block loading={save.isPending && !another} disabled={uploading || (save.isPending && another)}>
              {item ? "Save changes" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <PreviewFrame
        subtitle={`How buyers see ${code || "this item"}`}
        aside={item ? <ListingBadge state={listingState({ ...item, quantity: qty || item.quantity })} /> : null}
      >
        <div className="grid gap-6 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <div>
            <PreviewLabel>Browse and your shop page</PreviewLabel>
            <BrowseTilePreview src={cover} code={code} title={title} pricePaise={free || price ? pricePaise : null} meta={place || `@${shop.handle}`} />
          </div>
          <div className="space-y-5">
            <div>
              <PreviewLabel>In the room, when you open it</PreviewLabel>
              <RoomItemPreview src={cover} code={code} title={title} pricePaise={free || price ? pricePaise : null} quantity={qty || 1} />
            </div>
            {photos.length > 1 ? (
              <div>
                <PreviewLabel>Photos buyers can swipe through</PreviewLabel>
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {photos.map((p, i) => (
                    <img key={p.key} src={p.src} alt={`Photo ${i + 1}`} className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-white/5" />
                  ))}
                </div>
              </div>
            ) : null}
            {showNote && winnerNote.trim() ? (
              <div>
                <PreviewLabel>What the winner sees</PreviewLabel>
                <WinnerNotePreview note={winnerNote.trim()} code={code} />
              </div>
            ) : null}
            {description.trim() ? (
              <div>
                <PreviewLabel>Description</PreviewLabel>
                <p className="line-clamp-4 whitespace-pre-wrap text-[15px] text-fg-2">{description.trim()}</p>
              </div>
            ) : null}
          </div>
        </div>
      </PreviewFrame>
    </CreateLayout>
  );
}
