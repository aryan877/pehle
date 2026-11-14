import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bot, Camera, ImagePlus, Loader2, LogOut, Plus, Store, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CATEGORIES } from "~/components/shell";
import { Notice, PageHeader, Select } from "~/components/studio/bits";
import { PaymentsCard } from "~/components/studio/payments-card";
import { useSingleUpload } from "~/components/studio/photo-grid";
import { ShopHeaderPreview } from "~/components/studio/previews";
import { useShop, type Seller } from "~/components/studio/shop-context";
import { VPA } from "~/components/studio/sign-in";
import { Button, Empty, Field, Input, Textarea, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap } from "~/lib/api";
import { mediaUrl } from "~/lib/format";
import { useSignOut } from "~/lib/session";

export const Route = createFileRoute("/studio/settings")({
  component: SettingsPage,
});

const PRESETS: { key: string; placeholder: string }[] = [
  { key: "Shipping", placeholder: "Ships across India in 3 to 5 days. Free above ₹2,000, otherwise ₹80." },
  { key: "Cash on delivery", placeholder: "No cash on delivery. UPI only." },
  { key: "Returns", placeholder: "Exchange within 3 days for damage, with an unboxing video." },
  { key: "Sizes", placeholder: "Sarees are 6.3 m with an unstitched blouse piece." },
];

function policiesOf(shop: Seller): { key: string; value: string }[] {
  const existing = Object.entries((shop.policies ?? {}) as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string")
    .map(([key, value]) => ({ key, value: value as string }));
  const missing = PRESETS.filter((p) => !existing.some((e) => e.key.toLowerCase() === p.key.toLowerCase())).map((p) => ({ key: p.key, value: "" }));
  return [...existing, ...missing];
}

function SettingsPage() {
  const { shop, role } = useShop();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {role !== "owner" ? (
        <Empty title="Only the shop owner can change settings">Ask the owner if something here needs to change.</Empty>
      ) : (
        <>
          {/* Re-mount the form when switching shops so fields reset. */}
          <SettingsForm key={shop.id} shop={shop} />
          <PaymentsCard shopId={shop.id} />
        </>
      )}
      <div className="flex justify-center pt-2 xl:hidden">
        <Button
          variant="ghost"
          onClick={async () => {
            await signOut();
            await navigate({ to: "/studio" });
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </div>
  );
}

function Section({ title, hint, icon, children }: { title: string; hint?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl bg-surface p-4 shadow-surface sm:p-5">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {hint ? <p className="text-[14px] text-fg-2">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SettingsForm({ shop }: { shop: Seller }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(shop.displayName);
  const [tagline, setTagline] = useState(shop.tagline ?? "");
  const [category, setCategory] = useState(shop.category);
  const [city, setCity] = useState(shop.city ?? "");
  const [avatar, setAvatar] = useState<{ path: string | null; src: string | null }>({ path: shop.avatarPath ?? null, src: mediaUrl(shop.avatarPath) });
  const [cover, setCover] = useState<{ path: string | null; src: string | null }>({ path: shop.coverPath ?? null, src: mediaUrl(shop.coverPath) });
  const [upiVpa, setUpiVpa] = useState(shop.upiVpa ?? "");
  const [payee, setPayee] = useState(shop.upiPayeeName ?? "");
  const [holdMinutes, setHoldMinutes] = useState(String(shop.holdMinutes));
  const [maxHolds, setMaxHolds] = useState(String(shop.maxHoldsPerBuyer));
  const [policies, setPolicies] = useState(() => policiesOf(shop));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const hold = Number(holdMinutes);
  const holds = Number(maxHolds);
  const holdValid = Number.isInteger(hold) && hold >= 2 && hold <= 60;
  const holdsValid = Number.isInteger(holds) && holds >= 1 && holds <= 20;
  const vpaValid = !upiVpa.trim() || VPA.test(upiVpa.trim());

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/v1/shops/{shop_id}", {
          params: { path: { shop_id: shop.id } },
          body: {
            displayName: displayName.trim(),
            tagline: tagline.trim() || null,
            category,
            city: city.trim() || null,
            avatarPath: avatar.path,
            coverPath: cover.path,
            upiVpa: upiVpa.trim() || null,
            upiPayeeName: payee.trim() || null,
            holdMinutes: hold,
            maxHoldsPerBuyer: holds,
            policies: Object.fromEntries(policies.filter((p) => p.key.trim() && p.value.trim()).map((p) => [p.key.trim(), p.value.trim()])),
          },
        }),
      ),
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: keys.session });
      toast("Settings saved.", "success");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true);
    setter(v);
  };
  const avatarUpload = useSingleUpload((path, src) => touch(setAvatar)({ path, src }));
  const coverUpload = useSingleUpload((path, src) => touch(setCover)({ path, src }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <PageHeader
        title="Settings"
        subtitle={`@${shop.handle}`}
        actions={
          <Link to="/s/$handle" params={{ handle: shop.handle }}>
            <Button type="button" variant="secondary">
              <Store className="size-4" /> View shop page
            </Button>
          </Link>
        }
      />

      <Section title="Shop profile" hint="Your cover, photo and details on your shop page and every drop.">
        <ShopHeaderPreview
          name={displayName.trim()}
          handle={shop.handle}
          category={category}
          city={city.trim()}
          tagline={tagline.trim()}
          avatarSrc={avatar.src}
          coverSrc={cover.src}
          onCover={
            <button
              type="button"
              onClick={coverUpload.open}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-black/70 px-3 text-[14px] font-semibold text-white backdrop-blur hover:bg-black/80"
            >
              {coverUpload.busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} {cover.src ? "Change cover" : "Add cover"}
            </button>
          }
          onAvatar={
            <button
              type="button"
              onClick={avatarUpload.open}
              aria-label={avatar.src ? "Change shop photo" : "Add shop photo"}
              className="inline-flex size-9 items-center justify-center rounded-full bg-surface-3 text-fg ring-2 ring-canvas hover:bg-line-strong"
            >
              {avatarUpload.busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            </button>
          }
        />
        {avatarUpload.element}
        {coverUpload.element}
        <p className="text-[13px] text-muted">A wide cover works best, about 1600 by 400. New photos save with the rest of your settings.</p>
        <Field label="Shop name" htmlFor="s-name">
          <Input id="s-name" value={displayName} onChange={(e) => touch(setDisplayName)(e.target.value)} maxLength={80} required />
        </Field>
        <Field label="Tagline" htmlFor="s-tagline" hint="One line under your name in the room.">
          <Input id="s-tagline" value={tagline} onChange={(e) => touch(setTagline)(e.target.value)} maxLength={160} placeholder="Handwoven silks from Kanchipuram" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="s-category" hint="Where buyers find you on the home page.">
            <Select id="s-category" value={category} onChange={(e) => touch(setCategory)(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              <option value="other">Something else</option>
            </Select>
          </Field>
          <Field label="City" htmlFor="s-city">
            <Input id="s-city" value={city} onChange={(e) => touch(setCity)(e.target.value)} maxLength={60} placeholder="Noida" autoComplete="address-level2" />
          </Field>
        </div>
      </Section>

      <Section title="UPI payments" hint="Winners pay you directly from their UPI app. Pehle never holds the money.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="UPI ID" htmlFor="s-vpa" error={vpaValid ? null : "That doesn't look like a UPI ID, for example meera@okaxis."}>
            <Input id="s-vpa" value={upiVpa} onChange={(e) => touch(setUpiVpa)(e.target.value)} autoCapitalize="none" inputMode="email" placeholder="meera@okaxis" />
          </Field>
          <Field label="Name on UPI" htmlFor="s-payee">
            <Input id="s-payee" value={payee} onChange={(e) => touch(setPayee)(e.target.value)} maxLength={80} placeholder={displayName} />
          </Field>
        </div>
      </Section>

      <Section title="Claim rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minutes to pay" htmlFor="s-hold" error={holdValid ? null : "2 to 60 minutes"} hint="After this, the next buyer in line is offered the item.">
            <Input id="s-hold" inputMode="numeric" value={holdMinutes} onChange={(e) => touch(setHoldMinutes)(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Unpaid holds per buyer" htmlFor="s-max" error={holdsValid ? null : "1 to 20"} hint="Stops one person from grabbing everything without paying.">
            <Input id="s-max" inputMode="numeric" value={maxHolds} onChange={(e) => touch(setMaxHolds)(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
      </Section>

      <Section
        title="Shop policies"
        hint="The co-host answers buyers' questions in chat using only these words, and asks you before promising anything else."
        icon={
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg">
            <Bot className="size-5" />
          </span>
        }
      >
        <div className="space-y-3">
          {policies.map((p, i) => {
            const preset = PRESETS.find((x) => x.key === p.key);
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <Input
                  aria-label="Topic"
                  value={p.key}
                  onChange={(e) => touch(setPolicies)(policies.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  maxLength={40}
                  placeholder="Topic"
                  className="font-semibold"
                />
                <Textarea
                  aria-label={`${p.key || "Policy"} details`}
                  value={p.value}
                  onChange={(e) => touch(setPolicies)(policies.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  maxLength={600}
                  className="min-h-11"
                  rows={1}
                  placeholder={preset?.placeholder ?? "What should buyers know?"}
                />
                <Button type="button" variant="ghost" aria-label={`Remove ${p.key || "policy"}`} onClick={() => touch(setPolicies)(policies.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
        {policies.length < 12 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => touch(setPolicies)([...policies, { key: "", value: "" }])}>
            <Plus className="size-4" /> Add a topic
          </Button>
        ) : null}
      </Section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="sticky bottom-3 z-10 flex items-center justify-end gap-3">
        {dirty ? <span className="rounded-full bg-surface-3 px-3 py-1 text-[13px] font-semibold text-fg-2 shadow-lift">Unsaved changes</span> : null}
        <Button
          type="submit"
          size="lg"
          loading={save.isPending}
          disabled={!displayName.trim() || !holdValid || !holdsValid || !vpaValid || avatarUpload.busy || coverUpload.busy}
          className="shadow-lift"
        >
          Save settings
        </Button>
      </div>
    </form>
  );
}
