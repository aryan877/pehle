import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { linkButton } from "~/components/browse";
import { AppShell } from "~/components/shell";
import { ChatAvatar, DecisionChip, type ChipTone } from "~/components/chat-feed";
import { Button, cx, errorMessage, useToast } from "~/components/ui";
import { api, keys, unwrap } from "~/lib/api";
import { resetChat } from "~/lib/chat";
import { useSession } from "~/lib/session";

export const Route = createFileRoute("/try")({ component: TryDrop });

function TryDrop() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = session.data?.me;
  const demoOn = session.data?.demo ?? true;
  const start = useMutation({
    mutationFn: async () => {
      if (me?.kind !== "buyer") {
        // A guest buyer for this device: no sign-in, and it can only claim in the practice shop.
        const fresh = await unwrap(api.POST("/api/v1/demo/join"));
        await resetChat();
        queryClient.setQueryData(keys.session, fresh);
        void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      }
      return unwrap(api.POST("/api/v1/demo/race"));
    },
    onSuccess: (race) => {
      void navigate({ to: "/l/$slug", params: { slug: race.slug }, search: { demo: 1 } });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const seller = useMutation({
    mutationFn: async () => {
      const fresh = await unwrap(api.POST("/api/v1/demo/seller"));
      await resetChat();
      queryClient.setQueryData(keys.session, fresh);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      return fresh;
    },
    onSuccess: () => void navigate({ to: "/studio" }),
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1080px] space-y-12 overflow-x-clip pb-6 pt-2 sm:pt-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-[13px] font-medium text-fg">
              <span aria-hidden>🛍️</span> Practice drop
            </span>
            <h1 className="mt-4 text-balance font-display text-[40px] font-bold leading-[1.02] tracking-tight sm:text-[54px]">
              One piece, five buyers. <span className="text-accent">Who gets it?</span>
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-[17px] leading-relaxed text-fg-2">
              You and four other buyers race for one piece. Rivals are scripted; claims, holds and payments are real.
            </p>
            <div className="mt-7">
              <Button
                size="xl"
                className="h-14 px-8 text-[17px] shadow-glow"
                onClick={() => start.mutate()}
                loading={start.isPending}
                disabled={!demoOn || session.isPending}
              >
                Start the race <ArrowRight className="size-5" aria-hidden />
              </Button>
              <p className="mt-3 text-[13px] text-fg-2">
                {demoOn ? "No sign-in. Nobody is charged and nothing ships. About 30 seconds." : "The practice drop is switched off on this server."}
              </p>
              {me?.kind === "staff" ? (
                <p className="mt-3 max-w-md rounded-lg bg-surface px-3 py-2 text-[13px] text-fg-2 shadow-surface">
                  You're signed in to a shop. The race signs this browser in as a guest buyer, so sign in to your studio again afterwards.
                </p>
              ) : null}
            </div>
          </div>
          <RacePreview />
        </div>

        <section aria-labelledby="watch">
          <h2 id="watch" className="text-[22px] font-bold">
            What to watch for
          </h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            <Step n={1} icon="🙋" title="You get a place in line in milliseconds">
              Tap Claim. The server stamps your claim and gives you a position before anyone sees it in chat.
            </Step>
            <Step n={2} icon="⌛" title="Someone ahead doesn't pay">
              The rivals claim within two seconds. Whoever holds the piece without paying loses it when their time runs out.
            </Step>
            <Step n={3} icon="🎉" title="It moves to you, and you pay">
              Pehle hands it down the line by itself. Pay with a test UPI or card; the practice seller confirms in seconds.
            </Step>
          </ol>
        </section>

        <Numbers />

        <section className="grid gap-3 md:grid-cols-2">
          <Aside icon="🧾" title="Check the referee">
            Every drop has a public fairness log: each claim with the time it arrived, its place in line and how each order was paid.
            The room links to it.
          </Aside>
          <Aside icon="🏪" title="Same rules as real shops">
            The practice shop runs on the same claim rules, payment hold and waitlist as every shop on Pehle. Only the four rivals are
            scripted, and they never join the chat.
          </Aside>
        </section>

        <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-5 shadow-surface sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[17px] font-semibold">Now try the seller side</p>
            <p className="max-w-xl text-[15px] text-fg-2">
              Get a private practice shop with three items. Start a drop, open its link in a private window, and race yourself. No sign-in.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="secondary" onClick={() => seller.mutate()} loading={seller.isPending} disabled={!demoOn}>
              Open my practice shop
            </Button>
            <Link to="/sell" className={linkButton("soft", "lg")}>
              How it works for sellers
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: string; title: string; children: ReactNode }) {
  return (
    <li className="relative rounded-xl bg-surface p-5 shadow-surface">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.08] text-[18px]" aria-hidden>
          {icon}
        </span>
        <span className="font-display text-[15px] font-bold text-fg-2">Step {n}</span>
      </div>
      <h3 className="mt-3 text-[17px] font-semibold leading-snug">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </li>
  );
}

function Aside({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-surface">
      <div className="flex items-center gap-2">
        <span className="text-[18px]" aria-hidden>
          {icon}
        </span>
        <h3 className="text-[17px] font-semibold">{title}</h3>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed text-fg-2">{children}</p>
    </div>
  );
}

/** Real usage numbers from the server, shown only once there is something to show. */
function Numbers() {
  const stats = useQuery({ queryKey: keys.stats, queryFn: () => unwrap(api.GET("/api/v1/stats")), refetchInterval: 30_000 });
  const s = stats.data;
  if (!s || s.claims === 0) return null;
  const items = [
    { value: s.claims, label: s.claims === 1 ? "claim decided" : "claims decided" },
    { value: s.waitlistPromotions, label: s.waitlistPromotions === 1 ? "time a piece moved to the next buyer" : "times a piece moved to the next buyer" },
    { value: s.ordersPaid, label: s.ordersPaid === 1 ? "order paid" : "orders paid" },
  ].filter((i) => i.value > 0);
  return (
    <section aria-labelledby="numbers">
      <h2 id="numbers" className="text-[22px] font-bold">
        Across Pehle so far
      </h2>
      <p className="text-[13px] text-fg-2">Counted from this server's claim log, including practice races and load tests.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col-reverse justify-end rounded-xl bg-surface p-4 shadow-surface">
            <dt className="text-[13px] text-fg-2">{i.label}</dt>
            <dd className="tabular font-display text-[32px] font-bold leading-tight">{i.value.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type Beat = { name: string; chip?: { tone: ChipTone; label: string }; said?: string; grey?: string; you?: boolean; shop?: boolean };

/** One race, told the way a viewer sees it in the live chat. */
const BEATS: Beat[] = [
  { name: "Practice Sarees", shop: true, said: "R101 is up now 🔥 type mine" },
  { name: "Priya S.", chip: { tone: "hold", label: "✅ #1" }, said: "mine", grey: "got R101" },
  { name: "Rahul K.", chip: { tone: "wait", label: "⏳ #2" }, said: "mine", grey: "waiting" },
  { name: "You", you: true, chip: { tone: "wait", label: "⏳ #3" }, said: "mine", grey: "waiting" },
  { name: "Ananya M.", chip: { tone: "wait", label: "⏳ #4" }, said: "mine 🙏" },
  { name: "Priya S.", chip: { tone: "out", label: "⌛ Missed" }, grey: "didn't pay in time" },
  { name: "Rahul K.", chip: { tone: "hold", label: "✅ #2" }, grey: "got R101" },
  { name: "Rahul K.", chip: { tone: "out", label: "⌛ Missed" }, grey: "didn't pay either" },
  { name: "You", you: true, chip: { tone: "hold", label: "✅ #3" }, said: "omg it's mine", grey: "pay in 3:00" },
  { name: "You", you: true, chip: { tone: "won", label: "🎉 Won" }, grey: "paid ₹4,500" },
];

/** A looping sketch of one race as YouTube-style chat, so the idea lands before the visitor taps Start. */
function RacePreview() {
  const [shown, setShown] = useState(BEATS.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShown(1);
    const id = window.setInterval(() => setShown((n) => (n >= BEATS.length + 2 ? 1 : n + 1)), 1300);
    return () => window.clearInterval(id);
  }, []);
  const visible = BEATS.slice(0, Math.min(shown, BEATS.length)).slice(-6);
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <p className="sr-only">
        An example race: five buyers type mine for one saree. The first two hold it but do not pay in time, so it moves down the line
        to you, and you pay.
      </p>
      <div className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(circle,rgb(255_45_120/0.22),transparent_65%)] blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-[28px] border-[6px] border-[#2a2a2a] bg-[#0f0f0f] shadow-lift" aria-hidden>
        <div className="relative aspect-[16/9] overflow-hidden">
          <img src="/hero/s12.jpg" alt="" className="size-full object-cover" />
          <div className="scrim-top absolute inset-x-0 top-0 flex items-center gap-2 p-3">
            <ChatAvatar name="Practice Sarees" size={26} />
            <span className="text-[13px] font-medium text-white">Practice Sarees</span>
            <span className="ml-auto rounded-sm bg-[#ff0033] px-1.5 text-[11px] font-medium leading-[18px] text-white">LIVE</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
            <p className="truncate text-[13px] font-medium text-white">Kanjivaram silk saree, temple border</p>
            <p className="text-[15px] font-bold text-white">₹4,500</p>
          </div>
        </div>
        <div className="flex h-10 items-center border-b border-white/10 px-4 text-[14px] font-medium text-white">Live chat</div>
        <div className="flex h-[236px] flex-col justify-end gap-0.5 overflow-hidden py-2">
          {visible.map((b, i) => (
            <div key={`${shown}-${i}-${b.name}`} className={cx("flex animate-rise items-start gap-3 px-4 py-[3px] text-[13px] leading-5", b.you && "bg-white/[0.07]")}>
              <ChatAvatar name={b.name} size={22} />
              <p className="min-w-0 flex-1">
                {b.shop ? (
                  <span className="mr-2 rounded-full bg-[#f1f1f1] px-1.5 py-px font-medium text-[#0f0f0f]">{b.name}</span>
                ) : (
                  <span className="mr-2 font-medium text-[#aaaaaa]">{b.name}</span>
                )}
                {b.chip ? <DecisionChip tone={b.chip.tone}>{b.chip.label}</DecisionChip> : null}
                {b.said ? <span className="mr-1.5 text-white">{b.said}</span> : null}
                {b.grey ? <span className="text-[#aaaaaa]">{b.grey}</span> : null}
              </p>
            </div>
          ))}
        </div>
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-full bg-[#272727] py-1.5 pl-1.5 pr-4 text-[12px]">
          <ChatAvatar name="Practice Sarees" size={24} />
          <span className="truncate text-white">📌 First claim gets it. No booking numbers.</span>
        </div>
      </div>
    </div>
  );
}
