# Pehle architecture

Pehle ("pehle aao, pehle pao": first come, first served) is the link a seller or creator pins during
a YouTube or Instagram live so a crowd can grab limited stock fairly. Buyers claim in a Nexconn open
channel. The server decides who claimed first, holds the item for a timed payment (or awards a free
item instantly), posts a checkout card into the buyer's private conversation with the shop, and
promotes the next buyer if the winner does not pay in time.

## Shape

```
apps/web              Vite + React 19: browse, shop pages, drop room, inbox, checkout, seller studio
crates/pehle-api      Axum: sessions, REST API (OpenAPI), Nexconn and Razorpay webhooks, workers
crates/pehle-db       sqlx: compile-time checked reads, and calls into the app.* SQL functions
crates/pehle-nexconn  Nexconn Server API client, webhook signatures, chat ID scheme
packages/api-client   TypeScript client generated from the API's OpenAPI document
db/migrations         0001_schema.sql (tables, indexes), 0002_functions.sql (every write), 0003_access.sql
infra                 Docker images, compose file and Caddy config for one self-hosted server
scripts               seed data and the load test
```

Types flow one way: `SQL -> sqlx (checked at compile time) -> Rust structs (utoipa) -> openapi.json -> TypeScript`.

## Where the rules live

Every write is a Postgres function in the `app` schema. The API's pooled connections run
`set role pehle_api`, a role that can read tables but cannot insert, update or delete them; the
functions run as their owner (`security definer`, pinned `search_path`). So the rules cannot be
bypassed by any API bug, and the database tests run as that same role to prove it.

Each function is one transaction. Claims lock the item row (`select ... for update`), so buyers racing
for the last unit are serialised by the database; the lock order is always item, then claim, then
order, so concurrent calls cannot deadlock. Errors use SQLSTATE `PH403/404/409/422`, mapped to HTTP.

| Function | What it does |
|---|---|
| `app.claim` | Hold while units remain, otherwise waitlist; idempotent per Nexconn message ID; free items are won on the spot |
| `app.expire_due_holds` | Expire unpaid holds and promote the next buyer, skipping items another worker holds |
| `app.release_claim`, `app.cancel_order` | Buyer gives up or seller cancels; the next buyer is promoted |
| `app.gateway_paid` | Razorpay confirmed a payment; a late or short payment queues a refund instead |
| `app.report_payment`, `app.confirm_payment` | Manual UPI: buyer reports the reference, seller confirms |
| `app.create_live`, `app.update_live` | Announce a drop: time, description, stream link, ordered lineup |
| `app.start_live`, `app.drop_item`, `app.close_item`, `app.end_live` | Run the drop; start notifies reminders and the club; end queues the report |
| `app.toggle_reminder`, `app.take_drop_audience` | "Remind me", and who to notify (each reminder once) |
| `app.ensure_conversation` | The buyer-shop conversation (a Nexconn group), created on first use |
| `app.demo_lapse_hold` | Demo shop only: make a scripted rival miss their payment window |

Every function appends to `events` (the public fairness log, drop reports and traction numbers) and to
`outbox` (side effects) in the same transaction. Workers drain the outbox with retries, woken by
`pg_notify`, so a Nexconn outage never loses or duplicates a decision.
