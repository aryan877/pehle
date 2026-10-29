-- Pehle schema: every type, table, index and trigger, grouped by domain.
-- Nexconn IDs may contain only letters and digits, so every chat ID is a one-letter prefix plus a
-- UUID's 32 hex digits: t staff, u buyer, h shop co-host, v signed-out viewer, g shop club group,
-- c buyer-shop conversation; open channels are "live" plus the drop's slug.
-- Rules live in app.* functions (0002_functions.sql). Access control is in 0003_access.sql: the API
-- role reads tables directly but can only change data through those functions.

create extension if not exists citext;
create schema if not exists app;

create type live_status as enum ('draft', 'live', 'ended');
create type item_status as enum ('ready', 'open', 'closed');
create type claim_status as enum ('held', 'waitlisted', 'paid', 'expired', 'released', 'cancelled');
create type claim_source as enum ('chat', 'button', 'seller', 'youtube');
create type order_status as enum ('awaiting_payment', 'payment_reported', 'paid', 'cancelled', 'expired');
create type approval_status as enum ('pending', 'approved', 'declined', 'expired');
create type staff_role as enum ('owner', 'moderator');

create function touch_updated_at() returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

-- =============================================================================================
-- People and sessions
-- =============================================================================================

-- Sellers and their team. Google or a phone number verified by Firebase Authentication.
create table staff (
    id uuid primary key default gen_random_uuid(),
    google_sub text unique,
    email citext unique,
    phone_e164 text unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    firebase_uid text unique,
    display_name text not null check (char_length(display_name) between 1 and 80),
    avatar_url text,
    nexconn_user_id text generated always as ('t' || replace(id::text, '-', '')) stored unique,
    created_at timestamptz not null default now(),
    check (email is not null or phone_e164 is not null)
);

-- Buyers sign in with Google or a phone number. YouTube-only commenters get a placeholder buyer
-- until they link their YouTube name; demo buyers exist only in the public demo shop.
create table buyers (
    id uuid primary key default gen_random_uuid(),
    display_name text not null check (char_length(display_name) between 1 and 40),
    preferred_language text not null default 'en' check (preferred_language ~ '^[a-z]{2,3}$'),
    google_sub text unique,
    email citext unique,
    avatar_url text,
    phone_e164 text unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    firebase_uid text unique,
    youtube_channel_id text unique,
    youtube_name text,
    is_demo boolean not null default false,
    -- Scripted rival buyers in the demo shop. They never connect to chat.
    is_bot boolean not null default false,
    nexconn_user_id text generated always as ('u' || replace(id::text, '-', '')) stored unique,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

-- Opaque session tokens; only the SHA-256 digest is stored.
create table sessions (
    token_hash bytea primary key check (octet_length(token_hash) = 32),
    buyer_id uuid references buyers on delete cascade,
    staff_id uuid references staff on delete cascade,
    user_agent text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    expires_at timestamptz not null,
    check (num_nonnulls(buyer_id, staff_id) = 1)
);
create index sessions_expiry on sessions (expires_at);

-- =============================================================================================
-- Shops
-- =============================================================================================

create table sellers (
    id uuid primary key default gen_random_uuid(),
    handle citext not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
    display_name text not null check (char_length(display_name) between 1 and 80),
    tagline text check (char_length(tagline) <= 160),
    category text not null default 'other'
        check (category in ('sarees', 'ethnic', 'thrift', 'jewellery', 'sneakers', 'plants', 'beauty',
                            'home', 'merch', 'creator', 'other')),
    city text check (char_length(city) between 2 and 60),
    avatar_path text,
    cover_path text,
    upi_vpa text check (upi_vpa ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z]{2,64}$'),
    upi_payee_name text check (char_length(upi_payee_name) <= 80),
    hold_minutes int not null default 10 check (hold_minutes between 2 and 60),
    max_holds_per_buyer int not null default 3 check (max_holds_per_buyer between 1 and 20),
    -- Shop policies the AI co-host may quote: shipping, cod, returns, sizes. Free text per key.
    policies jsonb not null default '{}'::jsonb check (jsonb_typeof(policies) = 'object'),
    -- The public demo shop judges and new sellers try without real money.
    is_demo boolean not null default false,
    nexconn_group_id text generated always as ('g' || replace(id::text, '-', '')) stored unique,
    cohost_user_id text generated always as ('h' || replace(id::text, '-', '')) stored unique,
    created_at timestamptz not null default now()
);
create index sellers_by_category on sellers (category) where not is_demo;

create table seller_staff (
    seller_id uuid not null references sellers on delete cascade,
    staff_id uuid not null references staff on delete cascade,
    role staff_role not null,
    added_at timestamptz not null default now(),
    primary key (seller_id, staff_id)
);
create index seller_staff_by_staff on seller_staff (staff_id);

-- Buyers in the shop's club: drop alerts and the shop's Nexconn group channel.
create table followers (
    seller_id uuid not null references sellers on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    followed_at timestamptz not null default now(),
    primary key (seller_id, buyer_id)
);
create index followers_by_buyer on followers (buyer_id);

-- Buyers a shop refuses claims from (spam, repeated unpaid holds).
create table blocked_buyers (
    seller_id uuid not null references sellers on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    blocked_at timestamptz not null default now(),
    blocked_by uuid references staff on delete set null,
    primary key (seller_id, buyer_id)
);

-- The seller's own payment gateway (Razorpay). Money settles to the seller; Pehle never holds funds.
create table seller_payment_accounts (
    seller_id uuid primary key references sellers on delete cascade,
    provider text not null check (provider in ('razorpay')),
    key_id text not null check (key_id ~ '^rzp_(test|live)_[A-Za-z0-9]+$'),
    -- AES-256-GCM with the nonce prepended. Decrypted only inside the API process.
    key_secret_enc bytea not null,
    webhook_secret_enc bytea not null,
    live_mode boolean generated always as (key_id like 'rzp_live_%') stored,
    connected_by uuid references staff on delete set null,
    connected_at timestamptz not null default now()
);

-- =============================================================================================
-- Catalogue and drops
-- =============================================================================================

-- Codes are what the seller says on stream ("S12").
create table items (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references sellers on delete cascade,
    code text not null check (code ~ '^[A-Z0-9]{1,8}$'),
    title text not null check (char_length(title) between 1 and 120),
    description text check (char_length(description) <= 2000),
    price_paise bigint not null check (price_paise between 0 and 100000000),
    quantity int not null check (quantity between 1 and 999),
    image_path text,
    gallery_paths text[] not null default '{}' check (cardinality(gallery_paths) <= 8),
    -- Revealed only to buyers who won the item: a coupon code, a download link, a thank-you note.
    winner_note text check (char_length(winner_note) <= 500),
    status item_status not null default 'ready',
    open_live_id uuid,
    opened_at timestamptz,
    -- Next claim position; positions are never reused.
    claim_seq int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    unique (seller_id, code),
    check ((status = 'open') = (open_live_id is not null))
);
create index items_by_seller on items (seller_id, created_at desc) where archived_at is null;
create index items_open on items (open_live_id) where open_live_id is not null;

create function items_mark_opened() returns trigger language plpgsql as $$
begin
    if new.status = 'open' and old.status is distinct from 'open' then
        new.opened_at := clock_timestamp();
    end if;
    return new;
end $$;
create trigger items_mark_opened before update on items for each row execute function items_mark_opened();
create trigger items_touch before update on items for each row execute function touch_updated_at();

-- A drop: one live session with its own Nexconn open channel. Announced ahead with a lineup.
create table lives (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references sellers on delete cascade,
    slug text not null unique check (slug ~ '^[a-z0-9]{5,12}$'),
    title text not null check (char_length(title) between 1 and 120),
    description text check (char_length(description) <= 1000),
    stream_url text check (stream_url ~ '^https://'),
    status live_status not null default 'draft',
    scheduled_for timestamptz,
    pinned_item_id uuid references items on delete set null,
    nexconn_channel_id text generated always as ('live' || slug) stored unique,
    -- Set when the stream is a YouTube video; its public live chat is read for claims.
    youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
    youtube_live_chat_id text,
    youtube_page_token text,
    youtube_checked_at timestamptz,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    ended_at timestamptz
);
create unique index one_live_now_per_seller on lives (seller_id) where status = 'live';
create index lives_by_seller on lives (seller_id, created_at desc);
create index lives_live on lives (started_at desc) where status = 'live';
create index lives_upcoming on lives (scheduled_for) where status = 'draft' and scheduled_for is not null;
create index lives_youtube on lives (youtube_checked_at nulls first)
    where status = 'live' and youtube_video_id is not null;

alter table items add constraint items_open_live_fk foreign key (open_live_id) references lives on delete set null;

create table live_lineup (
    live_id uuid not null references lives on delete cascade,
    item_id uuid not null references items on delete cascade,
    sort int not null default 0,
    primary key (live_id, item_id)
);
create index live_lineup_by_item on live_lineup (item_id);

-- "Remind me" on an upcoming drop.
create table drop_reminders (
    live_id uuid not null references lives on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    created_at timestamptz not null default now(),
    notified_at timestamptz,
    primary key (live_id, buyer_id)
);
create index drop_reminders_by_buyer on drop_reminders (buyer_id);

-- One-time codes a signed-in buyer types in YouTube chat to prove a YouTube name is theirs.
create table youtube_link_codes (
    live_id uuid not null references lives on delete cascade,
    code text not null check (code ~ '^[0-9]{4}$'),
    buyer_id uuid not null references buyers on delete cascade,
    expires_at timestamptz not null,
    primary key (live_id, code)
);
create index youtube_link_codes_by_buyer on youtube_link_codes (live_id, buyer_id);

-- =============================================================================================
-- Claims and orders
-- =============================================================================================

create table claims (
    id uuid primary key default gen_random_uuid(),
    item_id uuid not null references items on delete cascade,
    live_id uuid not null references lives on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    position int not null check (position > 0),
    status claim_status not null,
    source claim_source not null,
    said text check (char_length(said) <= 500),
    nexconn_message_id text unique,
    nexconn_received_at timestamptz,
    decided_at timestamptz not null default clock_timestamp(),
    held_at timestamptz,
    hold_expires_at timestamptz,
    closed_at timestamptz,
    unique (item_id, position),
    check (status <> 'held' or (held_at is not null and hold_expires_at is not null and closed_at is null)),
    check (status not in ('expired', 'released', 'cancelled', 'paid') or closed_at is not null)
);
create unique index one_open_claim_per_buyer_item on claims (item_id, buyer_id)
    where status in ('held', 'waitlisted', 'paid');
create index claims_taken on claims (item_id) where status in ('held', 'paid');
create index claims_waitlist on claims (item_id, position) where status = 'waitlisted';
create index claims_due on claims (hold_expires_at) where status = 'held';
create index claims_by_live on claims (live_id, decided_at);
create index claims_held_by_buyer on claims (live_id, buyer_id) where status = 'held';
create index claims_by_buyer on claims (buyer_id, decided_at desc);

-- One order per hold. A promoted waitlister gets a fresh order.
create table orders (
    id uuid primary key default gen_random_uuid(),
    claim_id uuid not null unique references claims on delete cascade,
    seller_id uuid not null references sellers on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    item_id uuid not null references items on delete cascade,
    live_id uuid not null references lives on delete cascade,
    amount_paise bigint not null check (amount_paise >= 0),
    status order_status not null default 'awaiting_payment',
    upi_reference text check (char_length(upi_reference) between 6 and 40),
    ship_name text check (char_length(ship_name) <= 80),
    ship_phone text check (ship_phone ~ '^\+?[0-9]{10,15}$'),
    ship_address text check (char_length(ship_address) <= 500),
    ship_pincode text check (ship_pincode ~ '^[1-9][0-9]{5}$'),
    payment_link_id text unique,
    payment_link_url text,
    gateway_payment_id text unique,
    gateway_rrn text,
    paid_via text check (paid_via in ('gateway', 'seller_confirmed', 'free')),
    refund_id text,
    refund_reason text,
    created_at timestamptz not null default now(),
    payment_reported_at timestamptz,
    paid_at timestamptz,
    closed_at timestamptz,
    updated_at timestamptz not null default now()
);
create index orders_by_seller on orders (seller_id, created_at desc);
create index orders_by_buyer on orders (buyer_id, created_at desc);
create index orders_by_live on orders (live_id);
create index orders_link_poll on orders (created_at)
    where status in ('awaiting_payment', 'payment_reported') and payment_link_id is not null;
create trigger orders_touch before update on orders for each row execute function touch_updated_at();

-- =============================================================================================
-- Conversations, approvals and notifications
-- =============================================================================================

-- One conversation per buyer and shop: a Nexconn group holding the buyer, the shop team and the
-- shop's co-host. Checkout cards, questions and seller replies all live there.
create table conversations (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references sellers on delete cascade,
    buyer_id uuid not null references buyers on delete cascade,
    nexconn_group_id text generated always as ('c' || replace(id::text, '-', '')) stored unique,
    provisioned_at timestamptz,
    created_at timestamptz not null default now(),
    last_activity_at timestamptz not null default now(),
    unique (seller_id, buyer_id)
);
create index conversations_by_buyer on conversations (buyer_id, last_activity_at desc);
create index conversations_by_seller on conversations (seller_id, last_activity_at desc);

-- Decisions the AI co-host may not make alone (discounts, COD exceptions, longer holds).
create table approvals (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references sellers on delete cascade,
    live_id uuid references lives on delete cascade,
    buyer_id uuid references buyers on delete cascade,
    order_id uuid references orders on delete cascade,
    kind text not null check (kind in ('discount', 'extend_hold', 'cod', 'other')),
    question text not null check (char_length(question) <= 1000),
    proposed_reply text not null check (char_length(proposed_reply) <= 1000),
    status approval_status not null default 'pending',
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by uuid references staff on delete set null
);
create index approvals_pending on approvals (seller_id, created_at) where status = 'pending';

-- Browser push endpoints (Web Push with VAPID), for a buyer's or a seller's device.
create table push_subscriptions (
    endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
    buyer_id uuid references buyers on delete cascade,
    staff_id uuid references staff on delete cascade,
    p256dh text not null check (char_length(p256dh) between 40 and 200),
    auth text not null check (char_length(auth) between 10 and 100),
    user_agent text,
    created_at timestamptz not null default now(),
    last_success_at timestamptz,
    failures int not null default 0,
    check (num_nonnulls(buyer_id, staff_id) = 1)
);
create index push_by_buyer on push_subscriptions (buyer_id) where buyer_id is not null;
create index push_by_staff on push_subscriptions (staff_id) where staff_id is not null;

-- =============================================================================================
-- Event log, outbox and webhook idempotency
-- =============================================================================================

-- Append-only record of every decision: the public fairness log, drop reports and traction.
create table events (
    id bigint generated always as identity primary key,
    at timestamptz not null default clock_timestamp(),
    kind text not null,
    seller_id uuid,
    live_id uuid,
    item_id uuid,
    buyer_id uuid,
    claim_id uuid,
    order_id uuid,
    data jsonb not null default '{}'::jsonb
);
create index events_by_live on events (live_id, id) where live_id is not null;
create index events_by_seller on events (seller_id, id) where seller_id is not null;
create index events_by_kind on events (kind, at);

-- Side effects on Nexconn and other services, written in the same transaction as the decision.
create table outbox (
    id bigint generated always as identity primary key,
    kind text not null,
    payload jsonb not null,
    dedupe_key text unique,
    attempts int not null default 0,
    run_after timestamptz not null default now(),
    locked_until timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    done_at timestamptz
);
create index outbox_ready on outbox (run_after, id) where done_at is null;

create function outbox_notify() returns trigger language plpgsql as $$
begin
    perform pg_notify('outbox', new.id::text);
    return null;
end $$;
create trigger outbox_notify after insert on outbox for each row execute function outbox_notify();

-- Nexconn and Razorpay retry webhooks; each event is processed once.
create table webhook_events (
    event_id text primary key,
    kind text not null,
    received_at timestamptz not null default now()
);
create index webhook_events_age on webhook_events (received_at);
