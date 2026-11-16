// Race many buyers for one item through the real API and check the outcome is exactly fair.
// Usage: bun scripts/load-test.ts [buyers=2000] [quantity=10] [baseUrl=http://localhost:8790]
// Needs dev sign-in (PEHLE_DEV_LOGIN=true). Prints latency percentiles and fairness checks.
const buyers = Number(process.argv[2] ?? 2000);
const quantity = Number(process.argv[3] ?? 10);
const base = process.argv[4] ?? "http://localhost:8790";

async function request(cookie: string, method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-pehle": "1", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return { cookie: setCookie ? setCookie.split(";")[0]! : cookie, body: text ? JSON.parse(text) : null };
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// A seller with one item and a running drop.
const seller = await request("", "POST", "/api/v1/auth/dev", { email: "load@demo.pehle", displayName: "Load test" });
let cookie = seller.cookie;
let shop = seller.body.me.shops.find((s: { seller: { handle: string } }) => s.seller.handle === "load-test")?.seller;
if (!shop) shop = (await request(cookie, "POST", "/api/v1/shops", { handle: "load-test", displayName: "Load test", category: "other" })).body;
const code = `L${Date.now() % 1_000_000}`;
const item = (await request(cookie, "POST", `/api/v1/shops/${shop.id}/items`, { code, title: "Load test piece", pricePaise: 10_000, quantity })).body;
const lives = (await request(cookie, "GET", `/api/v1/shops/${shop.id}/lives`)).body as { id: string; status: string }[];
for (const running of lives.filter((l) => l.status === "live")) await request(cookie, "POST", `/api/v1/lives/${running.id}/end`);
let live = (await request(cookie, "POST", `/api/v1/shops/${shop.id}/lives`, { title: "Load test drop", itemIds: [item.id] })).body;
live = (await request(cookie, "POST", `/api/v1/lives/${live.id}/start`)).body;
await request(cookie, "POST", `/api/v1/lives/${live.id}/drop`, { itemId: item.id });

console.log(`Signing in ${buyers} buyers...`);
const sessions = await inBatches([...Array(buyers).keys()], 100, async (i) => (await request("", "POST", "/api/v1/session/buyer", { displayName: `Buyer ${i}` })).cookie);

console.log(`Racing ${buyers} claims for ${quantity} units at once...`);
const started = performance.now();
const results = await Promise.all(
  sessions.map(async (c) => {
    const t0 = performance.now();
    try {
      const r = await request(c, "POST", `/api/v1/rooms/${live.slug}/claims`, {});
      return { ms: performance.now() - t0, outcome: r.body.outcome as string, position: r.body.position as number };
    } catch (error) {
      return { ms: performance.now() - t0, outcome: "error", position: 0, error: String(error) };
    }
  }),
);
const wall = performance.now() - started;
const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]!.toFixed(0);
const count = (o: string) => results.filter((r) => r.outcome === o).length;
const positions = results.map((r) => r.position).filter(Boolean).sort((a, b) => a - b);
const unique = new Set(positions).size === positions.length && positions[0] === 1 && positions.at(-1) === positions.length;
const heldPositions = results.filter((r) => r.outcome === "held").map((r) => r.position).sort((a, b) => a - b);
const firstHeld = heldPositions.every((p, i) => p === i + 1);

await request(cookie, "POST", `/api/v1/lives/${live.id}/end`);
const report = {
  buyers,
  quantity,
  wallMs: Math.round(wall),
  claimsPerSecond: Math.round((buyers / wall) * 1000),
  latencyMs: { p50: pct(50), p95: pct(95), p99: pct(99), max: latencies.at(-1)!.toFixed(0) },
  held: count("held"),
  waitlisted: count("waitlisted"),
  errors: count("error"),
  checks: {
    exactlyQuantityHeld: count("held") === quantity,
    positionsUniqueAndContiguous: unique,
    holdsAreTheFirstPositions: firstHeld,
  },
};
console.log(JSON.stringify(report, null, 2));
const firstError = results.find((r) => r.outcome === "error");
if (firstError) console.log("first error:", (firstError as { error?: string }).error);
process.exit(Object.values(report.checks).every(Boolean) && report.errors === 0 ? 0 : 1);
