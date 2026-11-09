import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  ChevronDown,
  Clock,
  Gift,
  Hourglass,
  IndianRupee,
  Link2,
  ListChecks,
  MessageCircle,
  PackagePlus,
  ShieldCheck,
  Smartphone,
  Users,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { ShopAvatar, linkButton, place, useBrowse } from "~/components/browse";
import { AppShell, categoryLabel } from "~/components/shell";
import { useSignIn } from "~/components/sign-in";
import { Button, CodeChip } from "~/components/ui";
import type { DropCard } from "~/lib/api";
import { useSession } from "~/lib/session";

export const Route = createFileRoute("/sell")({ component: Sell });

function StartSelling({ size = "xl" }: { size?: "lg" | "xl" }) {
  const session = useSession();
  const signIn = useSignIn();
  if (session.data?.me.kind === "staff") {
    return (
      <Link to="/studio" className={linkButton("primary", size, "shadow-glow")}>
        Open your studio <ArrowRight className="size-5" aria-hidden />
      </Link>
    );
  }
  return (
    <Button size={size} className="shadow-glow" onClick={() => signIn({ role: "staff", next: "/studio" })}>
      Start selling <ArrowRight className="size-5" aria-hidden />
    </Button>
  );
}

function Sell() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1120px] space-y-16 overflow-x-clip pb-8 pt-2 sm:pt-8">
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-[13px] font-semibold text-fg-2 shadow-surface">
              <span className="size-2 rounded-full bg-accent" aria-hidden /> For YouTube and Instagram live sellers
            </p>
            <h1 className="mt-5 text-balance font-display text-[40px] font-bold leading-[1.02] tracking-tight sm:text-[56px]">
              No more “who said first” in your live chat.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-fg-2">
              Pin one Pehle link in your live. Pehle decides who claimed first, holds the piece while they pay, and hands it to the next
              buyer by itself when someone ghosts. No screenshots, no arguments, no lost sales.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <StartSelling />
              <Link to="/try" className={linkButton("secondary", "xl")}>
                <Zap className="size-5" aria-hidden /> Try a drop first
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-fg-2">Free during the beta. Buyers need no app.</p>
          </div>
          <PhonePreview />
        </section>

        <section aria-labelledby="pain" className="grid gap-3 md:grid-cols-3">
          <h2 id="pain" className="sr-only">
            What changes
          </h2>
          <Swap before="Twenty people type “mine” at once and you guess who was first." after="Every claim is stamped and put in line by the server in milliseconds." />
          <Swap before="The winner goes quiet after the live and the piece sits unsold." after="Their hold runs out and the next buyer is offered it automatically." />
          <Swap before="Losing buyers send screenshots and call it unfair." after="A public log shows every claim, its time and its place in line." />
        </section>

        <section aria-labelledby="how">
          <SectionHead id="how" title="Three steps, then Pehle runs the drop" />
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            <Step n={1} icon={<PackagePlus className="size-5" />} title="Add your items">
              A photo, a price, how many you have and a short code like S12 that you say on stream. Set ₹0 for a giveaway.
            </Step>
            <Step n={2} icon={<Link2 className="size-5" />} title="Share one link in your live">
              Pin it on YouTube or Instagram. Buyers tap Claim, or type the code in your YouTube chat.
            </Step>
            <Step n={3} icon={<ListChecks className="size-5" />} title="Pehle decides and collects">
              The first claim gets a timed hold and a payment link. Non-payers lose their turn. You see paid orders with addresses.
            </Step>
          </ol>
        </section>

        <section aria-labelledby="buyers" className="grid gap-8 rounded-2xl bg-surface p-6 shadow-surface sm:p-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <SectionHead id="buyers" title="What your buyers see" />
            <p className="mt-2 text-[15px] leading-relaxed text-fg-2">
              A clean room next to your stream, with your items, one Claim button and their place in line. It works in any phone
              browser.
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            <Point icon={<Smartphone className="size-4" />} title="No app to install">
              Your link opens in the browser. They sign in with Google or a phone number when they claim.
            </Point>
            <Point icon={<Hourglass className="size-4" />} title="Their place in line">
              Holding, or third in line. Never “sorry, it went to someone else” in a DM.
            </Point>
            <Point icon={<Clock className="size-4" />} title="A timer to pay">
              You choose the hold, from 2 to 60 minutes. The timer is on their screen.
            </Point>
            <Point icon={<MessageCircle className="size-4" />} title="A private chat with you">
              Questions about size, delivery or COD go to your shop inbox, not the public chat.
            </Point>
          </ul>
        </section>

        <section aria-label="Payments, giveaways and repeat buyers" className="grid gap-3 md:grid-cols-2">
          <Feature icon={<IndianRupee className="size-5" />} title="Money goes straight to you">
            Buyers pay your UPI ID or your own Razorpay account. Pehle never holds your money. With Razorpay connected, payments confirm
            themselves and show as verified on your shop page.
          </Feature>
          <Feature icon={<Gift className="size-5" />} title="Free drops for creators">
            Give away cohort seats, coupons or merch. At ₹0 the first to claim wins it on the spot and gets a private note only winners
            see, like a coupon code or a joining link.
          </Feature>
          <Feature icon={<Users className="size-5" />} title="A club that comes back">
            Viewers join your shop's club in one tap. When you go live, members get a push alert, and Remind me on upcoming drops brings
            the crowd in at the start.
          </Feature>
          <Feature icon={<ShieldCheck className="size-5" />} title="A record buyers can check">
            Your shop page shows drops run, items sold, payments verified by Razorpay and how fast buyers pay. It is computed from real
            claims, so nobody can edit it, you included.
          </Feature>
        </section>

        <Shops />

        <section aria-labelledby="faq" className="mx-auto max-w-3xl">
          <SectionHead id="faq" title="Questions sellers ask" />
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-surface">
            <Faq q="What does Pehle cost?">Nothing during the beta. You keep everything your buyers pay.</Faq>
            <Faq q="Do my buyers need an app?">
              No. The link opens in any phone browser. Buyers sign in with Google or their phone number when they claim, and the room
              shows only their first name and initial.
            </Faq>
            <Faq q="Does it work with YouTube and Instagram lives?">
              Yes. Pin the link on either. On YouTube, claims typed in your stream's chat count too, in the same line as taps in the
              room.
            </Faq>
            <Faq q="What happens when a buyer doesn't pay?">
              Their hold ends when the timer runs out. The next person in line is offered the piece automatically, even after your live
              has ended.
            </Faq>
            <Faq q="Who sees a buyer's phone number and address?">Only your shop, and only for orders that buyer won.</Faq>
            <Faq q="Can I run a giveaway without taking payments?">
              Yes. Set the price to ₹0. The first claims win at once, and you can attach a private note for winners.
            </Faq>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl bg-surface p-8 text-center shadow-surface sm:p-12">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" aria-hidden />
          <h2 className="relative text-balance font-display text-[30px] font-bold leading-tight sm:text-[38px]">Your next live can be the fair one.</h2>
          <p className="relative mx-auto mt-3 max-w-lg text-[15px] text-fg-2">Set up your shop, add a few pieces and share one link in your next stream.</p>
          <div className="relative mt-6 flex flex-wrap justify-center gap-3">
            <StartSelling size="lg" />
            <Link to="/try" className={linkButton("secondary", "lg")}>
              Try a drop first
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="text-balance font-display text-[28px] font-bold leading-tight sm:text-[32px]">
      {title}
    </h2>
  );
}

function Swap({ before, after }: { before: string; after: string }) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-surface">
      <p className="text-[15px] text-muted line-through decoration-muted/60">{before}</p>
      <p className="mt-3 flex gap-2 text-[15px] font-semibold text-fg">
        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
        {after}
      </p>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="rounded-xl bg-surface p-5 shadow-surface">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent text-white">{icon}</span>
        <span className="font-display text-[15px] font-bold text-fg-2">Step {n}</span>
      </div>
      <h3 className="mt-3 text-[17px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </li>
  );
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="rounded-xl bg-surface-2 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-fg-2">{children}</p>
    </li>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-6 shadow-surface">
      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</span>
      <h3 className="mt-4 text-[20px] font-bold">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold hover:bg-white/5 [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="size-5 shrink-0 text-fg-2 transition group-open:rotate-180" aria-hidden />
      </summary>
      <p className="px-5 pb-4 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </details>
  );
}

/** Real shops that have run or scheduled drops. Shown only when there are some. */
function Shops() {
  const feed = useBrowse();
  const seen = new Map<string, DropCard>();
  for (const drop of [...(feed.data?.live ?? []), ...(feed.data?.upcoming ?? []), ...(feed.data?.recent ?? [])]) {
    // Only shops that have set up a profile photo: test and half-made shops stay out of the showcase.
    if (drop.shopAvatarPath && !seen.has(drop.shopHandle)) seen.set(drop.shopHandle, drop);
  }
  const shops = [...seen.values()].slice(0, 6);
  if (shops.length === 0) return null;
  return (
    <section aria-labelledby="shops">
      <SectionHead id="shops" title="Shops already running drops" />
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shops.map((d) => (
          <li key={d.shopHandle}>
            <Link to="/s/$handle" params={{ handle: d.shopHandle }} className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-surface hover:bg-surface-2">
              <ShopAvatar name={d.shopName} path={d.shopAvatarPath} size={48} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{d.shopName}</p>
                <p className="truncate text-[13px] text-fg-2">{place(categoryLabel(d.shopCategory), d.shopCity)}</p>
                <p className="truncate text-[13px] text-fg-2">{d.status === "live" ? "Live now" : d.title}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The room at a busy claim moment, drawn in the real room's style. */
function PhonePreview() {
  const rows = [
    { name: "Priya", said: "mine", status: "held", pos: 1, colour: "#ff7ab6" },
    { name: "Ananya", said: "S12 mine!!", status: "held", pos: 2, colour: "#5ee3a1" },
    { name: "Ritu", said: "मेरा", status: "wait", pos: 3, colour: "#6cb2ff" },
    { name: "Farah", said: "ye wala", status: "wait", pos: 4, colour: "#ffc233" },
  ] as const;
  return (
    <div className="relative mx-auto w-full max-w-[340px]" aria-hidden>
      <div className="absolute -inset-12 -z-10 rounded-full bg-[radial-gradient(circle,rgb(255_45_120/0.3),transparent_65%)] blur-2xl" />
      <div className="overflow-hidden rounded-[2.2rem] border-[6px] border-surface-3 bg-canvas shadow-lift">
        <div className="relative aspect-[16/11] overflow-hidden">
          <img src="/hero/s12.jpg" alt="" className="size-full object-cover" />
          <div className="scrim-top absolute inset-x-0 top-0 flex items-center gap-2 p-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-[#6cb2ff] text-[10px] font-bold text-canvas">MS</span>
            <span className="text-[12px] font-bold text-white">Meera Sarees</span>
            <span className="ml-auto rounded bg-live px-1.5 text-[10px] font-bold leading-4 text-white">LIVE</span>
          </div>
        </div>
        <div className="border-b border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <CodeChip code="S12" />
            <p className="truncate text-[13px] font-bold">Banarasi silk, rani pink</p>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold text-gold">₹4,500</span>
            <span className="text-[11px] font-semibold text-fg-2">Both held, 2 in line</span>
          </div>
          <div className="mt-2 rounded-full bg-accent py-2.5 text-center text-[14px] font-extrabold text-white shadow-glow">Mine! Claim S12</div>
        </div>
        <div className="space-y-1 p-2">
          {rows.map((r) => (
            <div
              key={r.name}
              className={`flex items-center gap-1.5 rounded-md border-l-[3px] px-2 py-1 text-[11px] ${r.status === "held" ? "border-good bg-good-soft" : "border-gold bg-gold-soft"}`}
            >
              {r.status === "held" ? <BadgeCheck className="size-3 text-good" /> : <Hourglass className="size-3 text-gold" />}
              <b style={{ color: r.colour }}>{r.name}</b>
              <span className="truncate text-muted">“{r.said}”</span>
              <span className={`ml-auto rounded px-1 text-[10px] font-extrabold text-canvas ${r.status === "held" ? "bg-good" : "bg-gold"}`}>#{r.pos}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] text-fg-2">
            <BellRing className="size-3 text-good" /> Priya has <b className="text-fg">9:42</b> to pay, then Ritu gets it
          </div>
        </div>
      </div>
    </div>
  );
}
