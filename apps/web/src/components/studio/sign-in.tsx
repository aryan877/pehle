import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BadgeCheck, Check, Clock, IndianRupee, Loader2, Sparkles, Store, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell, CATEGORIES } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Button, Card, Field, Input, cx, errorMessage } from "~/components/ui";
import { api, keys, unwrap, type SessionInfo } from "~/lib/api";

import { Notice, Progress, Select } from "./bits";
import { CreateLayout, PanelSection, PreviewFrame, PreviewLabel } from "./create-layout";
import { DropCardPreview, ShopHeaderPreview } from "./previews";

const POINTS = [
  { icon: BadgeCheck, title: "First to claim wins", text: "When fifty people type the code at once, Pehle records who was first. No screenshots, no arguments." },
  { icon: Clock, title: "Unpaid holds move on", text: "Winners get a few minutes to pay. If they don't, the next person in line is offered it automatically." },
  { icon: IndianRupee, title: "Money goes straight to you", text: "Buyers pay your own UPI ID or Razorpay account. Pehle never holds it." },
];

/** Signed out, or signed in as a buyer: one focused page that opens the shared sign-in sheet. */
export function StudioSignIn({ session }: { session: SessionInfo }) {
  const signIn = useSignIn();
  const isBuyer = session.me.kind === "buyer";
  return (
    <AppShell>
      <div className="mx-auto grid max-w-[1040px] items-center gap-8 py-4 md:grid-cols-[1fr_400px] md:py-12">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-[13px] font-semibold text-accent">
            <Store className="size-4" /> Pehle for sellers and creators
          </p>
          <h1 className="mt-4 text-balance font-display text-[34px] font-bold leading-[1.05] sm:text-[44px]">Pin one link on your live. Pehle runs the line.</h1>
          <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-fg-2">
            List your pieces with short codes, announce the drop, then open items one at a time while you stream on YouTube or Instagram.
          </p>
          <ul className="mt-6 space-y-4">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-[15px] text-fg-2">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-[24px] font-bold">Sign in to your studio</h2>
          <p className="mt-1 text-[15px] text-fg-2">
            {isBuyer
              ? "You're signed in as a buyer. Sign in with the account your shop uses to manage drops."
              : "Your first sign-in sets up your shop. It takes about a minute."}
          </p>
          <Button size="lg" block className="mt-5" onClick={() => signIn({ role: "staff", next: "/studio" })}>
            Sign in to sell
          </Button>
          {session.demo ? (
            <Link to="/try" className="mt-4 flex items-center justify-center gap-1.5 text-[14px] font-semibold text-fg-2 hover:text-fg">
              <Sparkles className="size-4 text-gold" /> See a demo drop first
            </Link>
          ) : null}
          <p className="mt-5 border-t border-line pt-4 text-[13px] text-muted">
            Buying from a live? Open the link the shop shared, or{" "}
            <Link to="/" className="font-semibold text-fg-2 underline-offset-2 hover:underline">
              browse Pehle
            </Link>
            .
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

const HANDLE = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const VPA = /^[A-Za-z0-9._-]{2,255}@[A-Za-z]{2,64}$/;

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Whether a shop handle is free, checked against the public shop lookup. */
function useHandleFree(handle: string) {
  const debounced = useDebounced(handle, 350);
  const valid = HANDLE.test(debounced);
  const query = useQuery({
    queryKey: ["handle-free", debounced],
    enabled: valid,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { response } = await api.GET("/api/v1/shops/by-handle/{handle}", { params: { path: { handle: debounced } } });
      if (response.status === 404) return true;
      if (response.ok) return false;
      throw new Error("Couldn't check the handle.");
    },
  });
  const settled = debounced === handle && valid && query.isSuccess;
  return { checking: valid && (debounced !== handle || query.isFetching), free: settled ? query.data : undefined };
}

/** First run: create the shop, Marketplace create-listing style. */
export function CreateShop({ staffName, onSignOut }: { staffName: string; onSignOut: () => void }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [upiVpa, setUpiVpa] = useState("");
  const [payee, setPayee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const effectiveHandle = handleTouched ? handle : slugify(displayName);
  const handleValid = HANDLE.test(effectiveHandle);
  const availability = useHandleFree(effectiveHandle);
  const vpaValid = !upiVpa.trim() || VPA.test(upiVpa.trim());

  const steps = [displayName.trim(), handleValid && availability.free !== false, category, city.trim(), upiVpa.trim() && vpaValid];
  const done = steps.filter(Boolean).length;
  const ready = Boolean(displayName.trim()) && handleValid && availability.free !== false && Boolean(category) && vpaValid;

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/shops", {
          body: {
            handle: effectiveHandle,
            displayName: displayName.trim(),
            category,
            city: city.trim() || null,
            upiVpa: upiVpa.trim() || null,
            upiPayeeName: payee.trim() || displayName.trim() || null,
          },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.session }),
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (ready) create.mutate();
  };

  const handleHint = !effectiveHandle ? (
    "Lowercase letters, digits and hyphens. It appears in your shop link."
  ) : !handleValid ? null : availability.checking ? (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="size-3.5 animate-spin" /> Checking @{effectiveHandle}
    </span>
  ) : availability.free === false ? null : availability.free ? (
    <span className="inline-flex items-center gap-1.5 text-good">
      <Check className="size-3.5" /> @{effectiveHandle} is available
    </span>
  ) : null;
  const handleError =
    effectiveHandle && !handleValid
      ? "Use 3 to 30 lowercase letters, digits or hyphens, starting with a letter or digit."
      : availability.free === false
        ? `@${effectiveHandle} is taken. Try another.`
        : null;

  return (
    <AppShell bare>
      <CreateLayout
        crumb={`Welcome, ${staffName.split(" ")[0]}`}
        title="Set up your shop"
        closeTo="/"
        onSubmit={submit}
        panel={
          <>
            <PanelSection title="About your shop" hint="Buyers see this on your drops and your shop page.">
              <Field label="Shop name" htmlFor="shop-name" error={tried && !displayName.trim() ? "Give your shop a name." : null}>
                <Input id="shop-name" autoFocus maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Meera Sarees" />
              </Field>
              <Field label="Handle" htmlFor="shop-handle" error={handleError} hint={handleHint}>
                <div
                  className={cx(
                    "flex h-12 items-center rounded-md border bg-surface transition focus-within:border-accent focus-within:ring-1 focus-within:ring-accent",
                    handleError ? "border-accent" : "border-line-strong hover:border-fg-2/60",
                  )}
                >
                  <span className="pl-3.5 text-fg-2">@</span>
                  <input
                    id="shop-handle"
                    className="h-full w-full min-w-0 bg-transparent px-1 text-[15px] text-fg outline-none placeholder:text-muted"
                    value={effectiveHandle}
                    placeholder="meera-sarees"
                    onChange={(e) => {
                      setHandleTouched(true);
                      setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                    }}
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {availability.free === true && handleValid && !availability.checking ? <Check className="mr-3 size-5 shrink-0 text-good" aria-hidden /> : null}
                  {availability.free === false ? <X className="mr-3 size-5 shrink-0 text-accent" aria-hidden /> : null}
                </div>
              </Field>
              <Field label="Category" htmlFor="shop-category" error={tried && !category ? "Pick the category buyers would look in." : null}>
                <Select id="shop-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                  <option value="other">Something else</option>
                </Select>
              </Field>
              <Field label="City" htmlFor="shop-city" hint="Shown next to your name, for example Meera Sarees, Noida.">
                <Input id="shop-city" maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Noida" autoComplete="address-level2" />
              </Field>
            </PanelSection>

            <PanelSection title="Getting paid" hint="Winners pay you directly. You can also connect Razorpay later in Settings.">
              <Field label="UPI ID" htmlFor="shop-vpa" error={vpaValid ? null : "That doesn't look like a UPI ID, for example meera@okaxis."}>
                <Input id="shop-vpa" inputMode="email" autoCapitalize="none" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)} placeholder="meera@okaxis" />
              </Field>
              <Field label="Name on UPI" htmlFor="shop-payee" hint="Shown in the buyer's UPI app so they know it's you.">
                <Input id="shop-payee" maxLength={80} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={displayName || "Meera Sarees"} />
              </Field>
            </PanelSection>
            {error ? <Notice tone="error">{error}</Notice> : null}
          </>
        }
        footer={
          <div className="space-y-3">
            <Progress done={done} total={steps.length} label={done === steps.length ? "All set" : `${done} of ${steps.length} done`} />
            <Button type="submit" size="md" block loading={create.isPending} disabled={tried && !ready}>
              Create shop
            </Button>
            <button type="button" onClick={onSignOut} className="w-full text-center text-[14px] font-semibold text-fg-2 hover:text-fg">
              Sign out
            </button>
          </div>
        }
      >
        <PreviewFrame subtitle="Your shop page and drops update as you type.">
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <div>
              <PreviewLabel>Your shop page</PreviewLabel>
              <ShopHeaderPreview name={displayName} handle={effectiveHandle} category={category} city={city.trim()} />
            </div>
            <div>
              <PreviewLabel>A drop on the home page</PreviewLabel>
              <DropCardPreview title="Your first drop" shopName={displayName || "Your shop"} city={city.trim()} when="Sat, 7:00 pm" itemCount={6} />
            </div>
          </div>
          <div className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
            {[
              ["1", "Add your pieces", "Photo, price and a code like S12 that you say on stream."],
              ["2", "Announce the drop", "Pick a time and lineup, then share one link on WhatsApp and Instagram."],
              ["3", "Go live", "Open items one by one. Pehle holds each for the first claim and moves the line."],
            ].map(([n, title, text]) => (
              <div key={n} className="flex gap-3">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[13px] font-bold">{n}</span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-[14px] text-fg-2">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </PreviewFrame>
      </CreateLayout>
    </AppShell>
  );
}
