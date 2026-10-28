# Pehle

Fair drops for India's live sellers. A seller pins one link during a YouTube or Instagram live; when
more people want the same piece than there are pieces, Pehle decides who asked first, holds it for a
timed payment, and passes it to the next buyer if they don't pay.

*Pehle aao, pehle pao.*

## Stack

Rust (Axum, sqlx), Postgres 17, Vite + React 19, Nexconn chat.

## Plan

1. Schema, and the claim/hold rules as SQL functions.
2. API: sessions, drop rooms, checkout, payments.
3. Web: browse, drop room, seller studio.

## Run locally

```sh
bun install
bun run db:up
cp .env.example .env
```
