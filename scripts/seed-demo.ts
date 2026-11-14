// Seed local shops, drops and buyers through the public API (dev sign-in must be enabled).
// Usage: bun scripts/seed-demo.ts [baseUrl]. Safe to run again: existing shops and items are reused.
const base = process.argv[2] ?? "http://localhost:5173";

type Shop = { id: string; handle: string };
type Session = { me: { kind: string; shops?: { seller: Shop }[] } };

/** One signed-in client with its own cookie. */
function client() {
  let cookie = "";
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-pehle": "1", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  async function upload(file: string): Promise<string> {
    const form = new FormData();
    form.append("file", Bun.file(`${import.meta.dir}/demo-assets/${file}`), file);
    const response = await fetch(`${base}/api/v1/media`, { method: "POST", body: form, headers: { "x-pehle": "1", cookie } });
    if (!response.ok) throw new Error(`upload ${file}: ${response.status} ${await response.text()}`);
    return ((await response.json()) as { path: string }).path;
  }
  return { call, upload };
}

interface ItemSeed {
  code: string;
  title: string;
  pricePaise: number;
  quantity: number;
  photo: string;
  winnerNote?: string;
  /** Replace the photo on an existing item that is not in a running drop (photos are content-addressed). */
  refreshPhoto?: boolean;
}

interface ShopSeed {
  email: string;
  owner: string;
  handle: string;
  displayName: string;
  tagline: string;
  category: string;
  city: string;
  upiVpa: string;
  avatar: string;
  items: ItemSeed[];
}

async function seedShop(seed: ShopSeed) {
  const { call, upload } = client();
  const session = await call<Session>("POST", "/api/v1/auth/dev", { email: seed.email, displayName: seed.owner });
  let shop = session.me.shops?.find((s) => s.seller.handle === seed.handle)?.seller;
  if (!shop) {
    shop = await call<Shop>("POST", "/api/v1/shops", {
      handle: seed.handle,
      displayName: seed.displayName,
      category: seed.category,
      city: seed.city,
      upiVpa: seed.upiVpa,
      upiPayeeName: seed.displayName,
    });
  }
  await call("PATCH", `/api/v1/shops/${shop.id}`, {
    displayName: seed.displayName,
    tagline: seed.tagline,
    category: seed.category,
    city: seed.city,
    avatarPath: await upload(seed.avatar),
    upiVpa: seed.upiVpa,
    upiPayeeName: seed.displayName,
    holdMinutes: 10,
    maxHoldsPerBuyer: 3,
    policies: {
      Shipping: "Free shipping across India. Ships in 2 working days by Delhivery.",
      "Cash on delivery": "No COD. UPI only.",
      Returns: "Returns within 3 days only if the item is damaged, with an unboxing video.",
    },
  });
  const existing = await call<{ code: string; id: string; imagePath?: string | null; status: string }[]>("GET", `/api/v1/shops/${shop.id}/items`);
  const ids: Record<string, string> = Object.fromEntries(existing.map((i) => [i.code, i.id]));
  for (const { photo, refreshPhoto, ...item } of seed.items) {
    if (!ids[item.code]) {
      const imagePath = await upload(photo);
      ids[item.code] = (await call<{ id: string }>("POST", `/api/v1/shops/${shop.id}/items`, { ...item, imagePath })).id;
    } else if (refreshPhoto) {
      const current = existing.find((i) => i.code === item.code)!;
      const imagePath = await upload(photo);
      if (current.status === "ready" && current.imagePath !== imagePath) {
        await call("PUT", `/api/v1/shops/${shop.id}/items/${current.id}`, { ...item, imagePath });
      }
    }
  }
  return { call, shop, ids };
}

async function buyerClaims(slug: string, names: string[]) {
  for (const name of names) {
    const { call } = client();
    await call("POST", "/api/v1/session/buyer", { displayName: name, preferredLanguage: "hi" });
    await call("POST", `/api/v1/rooms/${slug}/claims`, {});
  }
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** The next time it is `hour`:00 in India (today if still ahead, else tomorrow). */
function nextIst(hour: number): string {
  const istOffset = 330 * 60_000;
  const nowIst = new Date(Date.now() + istOffset);
  const target = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), hour, 0, 0) - istOffset);
  if (target.getTime() < Date.now() + 30 * 60_000) target.setUTCDate(target.getUTCDate() + 1);
  return target.toISOString();
}

// A saree seller who is live right now.
const meera = await seedShop({
  email: "meera@demo.pehle",
  owner: "Meera",
  handle: "meera-sarees",
  displayName: "Meera Sarees",
  tagline: "Handwoven silks from Kanchipuram, live every Friday at 7 PM",
  category: "sarees",
  city: "Noida",
  upiVpa: "meerasarees@okaxis",
  avatar: "s12.jpg",
  items: [
    { code: "S12", title: "Banarasi silk, rani pink with gold zari", pricePaise: 450000, quantity: 2, photo: "s12.jpg" },
    { code: "S13", title: "Mysore silk, royal blue with mustard border", pricePaise: 285000, quantity: 1, photo: "s13.jpg" },
    { code: "B4", title: "Bangle set, ruby and antique gold", pricePaise: 120000, quantity: 3, photo: "b4.jpg" },
    { code: "S14", title: "Handloom cotton bundle, 3 sarees", pricePaise: 195000, quantity: 4, photo: "s14.jpg" },
  ],
});
const meeraLives = await meera.call<{ id: string; slug: string; status: string }[]>("GET", `/api/v1/shops/${meera.shop.id}/lives`);
let live = meeraLives.find((l) => l.status === "live");
if (!live) {
  live = await meera.call<{ id: string; slug: string; status: string }>("POST", `/api/v1/shops/${meera.shop.id}/lives`, {
    title: "Friday silk drop",
    description: "Four pieces, one of each. First to claim gets 10 minutes to pay.",
    itemIds: [meera.ids.S12, meera.ids.S13, meera.ids.B4, meera.ids.S14],
  });
  live = await meera.call("POST", `/api/v1/lives/${live!.id}/start`);
  await meera.call("POST", `/api/v1/lives/${live!.id}/drop`, { itemId: meera.ids.B4 });
  await meera.call("POST", `/api/v1/lives/${live!.id}/drop`, { itemId: meera.ids.S12 });
  await buyerClaims(live!.slug, ["Priya from Pune", "Ananya", "Ritu", "Meenakshi", "Farah"]);
}
const meeraUpcoming = meeraLives.find((l) => l.status === "draft");
if (!meeraUpcoming) {
  await meera.call("POST", `/api/v1/shops/${meera.shop.id}/lives`, {
    title: "Sunday cotton specials",
    description: "Everyday handloom cotton under ₹2,000.",
    scheduledFor: inHours(26),
    itemIds: [meera.ids.S14, meera.ids.S13],
  });
}

// A thrift store with a drop tomorrow evening.
const thrift = await seedShop({
  email: "kabir@demo.pehle",
  owner: "Kabir",
  handle: "second-hand-story",
  displayName: "Second Hand Story",
  tagline: "One-of-one thrift from Bengaluru. Drops every Sunday, 8 PM.",
  category: "thrift",
  city: "Bengaluru",
  upiVpa: "secondhandstory@ybl",
  avatar: "thrift-rack.jpg",
  items: [
    { code: "T1", title: "Hand-block printed kurta set, size M", pricePaise: 89900, quantity: 1, photo: "s14.jpg" },
    { code: "T2", title: "Vintage glass bangle stack", pricePaise: 34900, quantity: 1, photo: "b4.jpg" },
    { code: "T3", title: "Pre-loved silk dupatta, teal", pricePaise: 59900, quantity: 1, photo: "s13.jpg" },
  ],
});
const thriftLives = await thrift.call<{ status: string }[]>("GET", `/api/v1/shops/${thrift.shop.id}/lives`);
if (!thriftLives.some((l) => l.status === "draft")) {
  await thrift.call("POST", `/api/v1/shops/${thrift.shop.id}/lives`, {
    title: "Sunday thrift drop",
    description: "Three one-of-one pieces. Claim fast, pay in 10 minutes.",
    scheduledFor: inHours(5),
    itemIds: [thrift.ids.T1, thrift.ids.T2, thrift.ids.T3],
  });
}

// A creator giving away free cohort seats.
const creator = await seedShop({
  email: "dev@demo.pehle",
  owner: "Dev",
  handle: "code-with-dev",
  displayName: "Code with Dev",
  tagline: "Live coding every evening. Free seats for the fastest fingers.",
  category: "creator",
  city: "Jaipur",
  upiVpa: "codewithdev@okicici",
  avatar: "code-laptop.jpg",
  items: [
    {
      code: "SEAT",
      title: "Free seat in the weekend web dev cohort",
      pricePaise: 0,
      quantity: 25,
      photo: "code-screen.jpg",
      winnerNote: "Your seat is confirmed. Use code PEHLE100 at checkout on the cohort page.",
      refreshPhoto: true,
    },
  ],
});
const creatorLives = await creator.call<{ status: string }[]>("GET", `/api/v1/shops/${creator.shop.id}/lives`);
if (!creatorLives.some((l) => l.status === "draft")) {
  await creator.call("POST", `/api/v1/shops/${creator.shop.id}/lives`, {
    title: "25 free cohort seats, live at 9 PM",
    description: "Free for the first 25 people to claim during the stream.",
    scheduledFor: nextIst(21),
    itemIds: [creator.ids.SEAT],
  });
}

console.log(
  JSON.stringify({
    live: `${base}/l/${live!.slug}`,
    console: `${base}/studio/live/${live!.id}`,
    shops: [meera.shop.handle, thrift.shop.handle, creator.shop.handle],
  }),
);
