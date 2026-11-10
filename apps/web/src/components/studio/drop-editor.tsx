import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, BarChart3, Camera, Check, GripVertical, ImageIcon, MonitorPlay, Plus, RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";

import { Avatar, Badge, Button, CodeChip, Field, Input, Sheet, Textarea, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap, type ItemWithCounts, type Live, type PublicItem } from "~/lib/api";
import { mediaUrl, streamHost } from "~/lib/format";

import { Notice, Progress, priceLabel } from "./bits";
import { CreateLayout, PanelSection, PreviewFrame, PreviewLabel } from "./create-layout";
import { DropCardPreview, LineupStripPreview } from "./previews";
import { listingState, move } from "./queries";
import { ShareKit } from "./share-kit";
import { useShop } from "./shop-context";
import { dropTime, fromLocalInput, suggestedStart, toLocalInput } from "./time";

interface LineupEntry {
  id: string;
  code: string;
  title: string;
  pricePaise: number;
  imagePath?: string | null;
  unitsLeft: number;
  quantity: number;
  status: ItemWithCounts["status"];
}

const HTTPS = /^https:\/\/\S+\.\S+$/;

/** Create or edit a drop: details, start time, stream link and the ordered lineup, with a live preview. */
export function DropEditor({
  live,
  lineup,
  items,
  roomUrl,
}: {
  live: Live | null;
  lineup: PublicItem[];
  items: ItemWithCounts[];
  roomUrl: string | null;
}) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const ended = live?.status === "ended";

  const [title, setTitle] = useState(live?.title ?? "");
  const [description, setDescription] = useState(live?.description ?? "");
  const [when, setWhen] = useState(live ? toLocalInput(live.scheduledFor) : suggestedStart());
  const [streamUrl, setStreamUrl] = useState(live?.streamUrl ?? "");
  const [ids, setIds] = useState<string[]>(() => lineup.map((i) => i.id));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, LineupEntry>();
    for (const i of lineup) map.set(i.id, { ...i });
    for (const i of items) map.set(i.id, i);
    return map;
  }, [items, lineup]);
  const entries = ids.map((id) => byId.get(id)).filter((e): e is LineupEntry => Boolean(e));

  const url = streamUrl.trim();
  const host = streamHost(url);
  const titleError = !title.trim() ? "Give the drop a title buyers will recognise." : null;
  const urlError = url && !HTTPS.test(url) ? "Paste the full link, starting with https://" : null;
  const scheduledIso = fromLocalInput(when);
  const past = Boolean(scheduledIso && live?.status !== "live" && new Date(scheduledIso).getTime() < Date.now() - 60_000);
  const steps = [!titleError, Boolean(scheduledIso), Boolean(url) && !urlError, entries.length > 0];
  const done = steps.filter(Boolean).length;
  const valid = !titleError && !urlError && description.length <= 1000;

  const body = () => ({
    title: title.trim(),
    description: description.trim() || null,
    streamUrl: url || null,
    scheduledFor: scheduledIso,
    itemIds: entries.map((e) => e.id),
  });

  const save = useMutation({
    mutationFn: () =>
      live
        ? unwrap(api.PATCH("/api/v1/lives/{live_id}", { params: { path: { live_id: live.id } }, body: body() }))
        : unwrap(api.POST("/api/v1/shops/{shop_id}/lives", { params: { path: { shop_id: shop.id } }, body: body() })),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.lives(shop.id) }),
        queryClient.invalidateQueries({ queryKey: keys.lineup(saved.id) }),
        queryClient.invalidateQueries({ queryKey: keys.console(saved.id) }),
      ]);
      if (live) {
        toast("Drop saved.", "success");
      } else {
        toast("Drop created. Share the link so people set a reminder.", "success");
        await navigate({ to: "/studio/drops/$liveId", params: { liveId: saved.id } });
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (valid && !ended) save.mutate();
  };

  const show = (m: string | null) => (tried ? m : null);
  const cover = mediaUrl(entries[0]?.imagePath);

  return (
    <CreateLayout
      crumb="Studio, Drops"
      title={live ? (ended ? "Past drop" : "Edit drop") : "Create drop"}
      closeTo="/studio/drops"
      onSubmit={submit}
      lead={live && roomUrl && !ended ? <ShareKit live={live} roomUrl={roomUrl} itemCount={entries.length} /> : null}
      panel={
        <fieldset disabled={ended} className="min-w-0 space-y-5">
          {live?.status === "live" ? <Notice tone="warn">This drop is live. Changes show in the room straight away.</Notice> : null}
          {ended ? <Notice>This drop has ended, so it can't be changed. Run it again to reuse the lineup.</Notice> : null}

          <PanelSection title="Details">
            <Field label="Title" htmlFor="drop-title" error={show(titleError)}>
              <Input id="drop-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Friday silk drop" />
            </Field>
            <Field label="Description (optional)" htmlFor="drop-desc" hint={`${description.length} of 1,000. Shown under the title in the room.`}>
              <Textarea
                id="drop-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                className="min-h-20"
                placeholder="Six handwoven pieces, one of each. First to claim gets 10 minutes to pay."
              />
            </Field>
          </PanelSection>

          <PanelSection title="When" hint="Upcoming drops show on the home page with a Remind me button.">
            <Field label="Start date and time" htmlFor="drop-when" hint={past ? undefined : scheduledIso ? dropTime(scheduledIso) : "Leave empty to go live whenever you're ready."}>
              <Input id="drop-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="[color-scheme:dark]" />
            </Field>
            {past ? <Notice tone="warn">That time has passed. Buyers will see it as starting soon.</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <TimeChip label="In 1 hour" onPick={() => setWhen(toLocalInput(new Date(Date.now() + 3_600_000).toISOString()))} />
              <TimeChip label="Today, 7:00 pm" onPick={() => setWhen(atHour(0, 19))} />
              <TimeChip label="Tomorrow, 7:00 pm" onPick={() => setWhen(atHour(1, 19))} />
              {when ? <TimeChip label="Clear" onPick={() => setWhen("")} /> : null}
            </div>
          </PanelSection>

          <PanelSection title="Stream link" hint="Your YouTube or Instagram live. You can add it just before you go live.">
            <Field label="Live link" htmlFor="drop-url" error={show(urlError) ?? (url && urlError ? urlError : null)}>
              <Input
                id="drop-url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={streamUrl}
                onChange={(e) => setStreamUrl(e.target.value)}
                placeholder="https://youtube.com/live/..."
              />
            </Field>
            {url && !urlError ? <StreamHint host={host} /> : null}
          </PanelSection>

          <PanelSection title="Lineup" hint="The items you'll open, in order. Buyers see this before the drop starts.">
            <LineupPicker entries={entries} setIds={setIds} items={items} />
          </PanelSection>

          {error ? <Notice tone="error">{error}</Notice> : null}
        </fieldset>
      }
      footer={
        ended && live ? (
          <div className="flex gap-2">
            <Link to="/studio/drops/$liveId/report" params={{ liveId: live.id }} className="flex-1">
              <Button type="button" variant="secondary" block>
                <BarChart3 className="size-4" /> Report
              </Button>
            </Link>
            <RunAgainButton live={live} itemIds={entries.map((e) => e.id)} block />
          </div>
        ) : (
          <div className="space-y-3">
            <Progress done={done} total={steps.length} label={done === steps.length ? "Ready to share" : `${done} of ${steps.length} done. Only the title is required.`} />
            <Button type="submit" block loading={save.isPending} disabled={tried && !valid}>
              {live ? "Save changes" : "Create drop"}
            </Button>
          </div>
        )
      }
    >
      <div className="mx-auto w-full max-w-[1000px]">
        <PreviewFrame subtitle="How buyers see this drop">
          <div className="grid gap-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
            <div>
              <PreviewLabel>On the home page and your shop page</PreviewLabel>
              <DropCardPreview
                coverSrc={cover}
                title={title.trim()}
                shopName={shop.displayName}
                avatarSrc={mediaUrl(shop.avatarPath)}
                city={shop.city}
                when={scheduledIso ? dropTime(scheduledIso) : null}
                itemCount={entries.length}
                live={live?.status === "live"}
              />
            </div>
            <div className="min-w-0">
              <PreviewLabel>In the room</PreviewLabel>
              <div className="overflow-hidden rounded-2xl bg-canvas ring-1 ring-line">
                <div className="relative flex aspect-[16/8] items-center justify-center bg-surface-2 text-center">
                  {cover ? <img src={cover} alt="" className="absolute inset-0 size-full object-cover opacity-30 blur-sm" /> : null}
                  <div className="relative px-4">
                    {host === "youtube" ? (
                      <p className="flex items-center gap-2 text-[14px] font-semibold">
                        <MonitorPlay className="size-5 text-live" /> Your YouTube live plays here
                      </p>
                    ) : host === "instagram" ? (
                      <p className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-[14px] font-semibold">
                        <Camera className="size-4" /> Watch on Instagram
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-[14px] text-fg-2">
                        <ImageIcon className="size-5" /> Add a stream link to show your video
                      </p>
                    )}
                  </div>
                  <span className="absolute left-2 top-2">
                    {live?.status === "live" ? (
                      <Badge tone="live">Live</Badge>
                    ) : (
                      <span className="rounded-full bg-black/65 px-2 py-0.5 text-[12px] font-semibold text-white">
                        {scheduledIso ? `Starts ${dropTime(scheduledIso, true)}` : "Starting soon"}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3">
                  <Avatar name={shop.displayName} src={mediaUrl(shop.avatarPath)} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold">{title.trim() || "Your drop title"}</p>
                    <p className="truncate text-[13px] text-fg-2">{shop.displayName}</p>
                    {description.trim() ? <p className="mt-1 line-clamp-2 text-[13px] text-fg-2">{description.trim()}</p> : null}
                  </div>
                </div>
                <div className="border-t border-line p-3">
                  <PreviewLabel>Coming up</PreviewLabel>
                  <LineupStripPreview items={entries.map((e) => ({ id: e.id, code: e.code, title: e.title, pricePaise: e.pricePaise, src: mediaUrl(e.imagePath) }))} />
                </div>
              </div>
            </div>
          </div>
        </PreviewFrame>
      </div>
    </CreateLayout>
  );
}

function atHour(daysAhead: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

function TimeChip({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="h-8 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-fg hover:bg-surface-3">
      {label}
    </button>
  );
}

function StreamHint({ host }: { host: ReturnType<typeof streamHost> }) {
  if (host === "youtube") {
    return (
      <Notice tone="good">
        <span className="flex gap-2">
          <MonitorPlay className="mt-0.5 size-4 shrink-0" />
          <span>YouTube: the video plays inside the room, and viewers can also claim by typing the code in your YouTube chat.</span>
        </span>
      </Notice>
    );
  }
  if (host === "instagram") {
    return (
      <Notice>
        <span className="flex gap-2">
          <Camera className="mt-0.5 size-4 shrink-0" />
          <span>Instagram: the room shows a Watch on Instagram button. Viewers claim in the room.</span>
        </span>
      </Notice>
    );
  }
  return <Notice>Buyers open your stream from a button in the room.</Notice>;
}

/** The ordered lineup: reorder by dragging or with the arrows, add from the catalogue in a sheet. */
function LineupPicker({ entries, setIds, items }: { entries: LineupEntry[]; setIds: Dispatch<SetStateAction<string[]>>; items: ItemWithCounts[] }) {
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  if (!items.length && !entries.length) {
    return (
      <div className="rounded-lg bg-surface-2 p-4 text-center">
        <p className="text-[15px]">Your catalogue is empty.</p>
        <Link to="/studio/catalog/new" className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[14px] font-semibold hover:bg-white/15">
          <Plus className="size-4" /> Add an item
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {entries.length ? (
        <ol className="space-y-1.5">
          {entries.map((e, index) => {
            const soldOut = e.unitsLeft === 0;
            return (
              <li
                key={e.id}
                draggable
                onDragStart={(ev) => {
                  setDragging(index);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", e.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(ev) => dragging !== null && ev.preventDefault()}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (dragging !== null) setIds((ids) => move(ids, dragging, index));
                  setDragging(null);
                }}
                className={cx("flex items-center gap-2 rounded-lg bg-surface-2 p-1.5 pr-1", dragging === index && "opacity-40")}
              >
                <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted sm:block" aria-hidden />
                <span className="w-4 shrink-0 text-center text-[13px] font-bold text-fg-2">{index + 1}</span>
                <Thumb path={e.imagePath} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <CodeChip code={e.code} className="text-[11px]" />
                    <span className="truncate text-[14px] font-semibold">{e.title}</span>
                  </div>
                  <p className={cx("truncate text-[13px]", soldOut ? "text-gold" : "text-fg-2")}>
                    {priceLabel(e.pricePaise)}, {soldOut ? "sold out" : `${e.unitsLeft} of ${e.quantity} left`}
                    {soldOut ? (
                      <>
                        {" "}
                        <Link to="/studio/catalog/$itemId" params={{ itemId: e.id }} className="font-semibold underline underline-offset-2">
                          Restock
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton label={`Move ${e.code} up`} disabled={index === 0} onClick={() => setIds((ids) => move(ids, index, index - 1))}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton label={`Move ${e.code} down`} disabled={index === entries.length - 1} onClick={() => setIds((ids) => move(ids, index, index + 1))}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton label={`Remove ${e.code} from the lineup`} onClick={() => setIds((ids) => ids.filter((id) => id !== e.id))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[14px] text-fg-2">No items yet. Add the pieces you'll open in this drop.</p>
      )}
      <Button type="button" variant="secondary" block onClick={() => setPicking(true)}>
        <Plus className="size-4" /> {entries.length ? "Add or remove items" : "Choose items"}
      </Button>
      <PickerSheet open={picking} onClose={() => setPicking(false)} items={items} selected={entries.map((e) => e.id)} setIds={setIds} />
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-full text-fg-2 hover:bg-white/10 hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Thumb({ path }: { path?: string | null }) {
  const src = mediaUrl(path);
  return src ? (
    <img src={src} alt="" className="size-11 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted">
      <ImageIcon className="size-4" />
    </span>
  );
}

function PickerSheet({
  open,
  onClose,
  items,
  selected,
  setIds,
}: {
  open: boolean;
  onClose: () => void;
  items: ItemWithCounts[];
  selected: string[];
  setIds: Dispatch<SetStateAction<string[]>>;
}) {
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => [...items].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [items]);
  const q = query.trim().toLowerCase();
  const shown = sorted.filter((i) => !q || i.code.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));
  const ready = sorted.filter((i) => listingState(i) === "ready" && !selected.includes(i.id));
  const toggle = (id: string) => setIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <Sheet open={open} onClose={onClose} title="Choose items" wide>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-2 px-3 text-fg-2">
            <Search className="size-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code or title"
              aria-label="Search your catalogue"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-2"
            />
          </label>
          {ready.length ? (
            <Button type="button" variant="secondary" onClick={() => setIds((ids) => [...ids, ...ready.map((i) => i.id)])}>
              Add all ready ({ready.length})
            </Button>
          ) : null}
        </div>
        <ul className="max-h-[50dvh] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
          {shown.map((i) => {
            const on = selected.includes(i.id);
            const position = selected.indexOf(i.id) + 1;
            const state = listingState(i);
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => toggle(i.id)}
                  aria-pressed={on}
                  className={cx("flex w-full items-center gap-3 rounded-lg p-1.5 pr-3 text-left transition", on ? "bg-accent-soft" : "hover:bg-white/5")}
                >
                  <Thumb path={i.imagePath} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CodeChip code={i.code} className="text-[11px]" />
                      <span className="truncate text-[15px] font-semibold">{i.title}</span>
                    </div>
                    <p className="truncate text-[13px] text-fg-2">
                      {priceLabel(i.pricePaise)}, {i.unitsLeft} of {i.quantity} left
                      {state === "open" ? ", open in a drop now" : ""}
                    </p>
                  </div>
                  <span
                    className={cx(
                      "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
                      on ? "bg-accent text-white" : "ring-2 ring-inset ring-line-strong",
                    )}
                  >
                    {on ? position || <Check className="size-4" /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length ? <li className="py-6 text-center text-fg-2">Nothing matches.</li> : null}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-[14px] text-fg-2">
            {selected.length} in the lineup.{" "}
            <Link to="/studio/catalog/new" className="font-semibold text-fg underline-offset-2 hover:underline">
              New item
            </Link>
          </p>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Make a new drop with the same details and lineup, then open it to set a time. */
export function useRunAgain(live: Live | null) {
  const { shop } = useShop();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: async (itemIds?: string[]) => {
      const ids = itemIds ?? (await unwrap(api.GET("/api/v1/lives/{live_id}/lineup", { params: { path: { live_id: live!.id } } }))).map((i) => i.id);
      return unwrap(
        api.POST("/api/v1/shops/{shop_id}/lives", {
          params: { path: { shop_id: shop.id } },
          body: { title: live!.title, description: live!.description ?? null, streamUrl: live!.streamUrl ?? null, scheduledFor: null, itemIds: ids },
        }),
      );
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: keys.lives(shop.id) });
      toast("New drop ready with the same lineup. Pick a start time and share it.", "success");
      await navigate({ to: "/studio/drops/$liveId", params: { liveId: created.id } });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
}

export function RunAgainButton({ live, itemIds, block, variant = "primary" }: { live: Live; itemIds?: string[]; block?: boolean; variant?: "primary" | "secondary" }) {
  const runAgain = useRunAgain(live);
  return (
    <Button type="button" variant={variant} block={block} className={block ? "flex-1" : undefined} loading={runAgain.isPending} onClick={() => runAgain.mutate(itemIds)}>
      <RotateCcw className="size-4" /> Run it again
    </Button>
  );
}
