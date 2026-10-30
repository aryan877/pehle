-- Pehle's RPC surface: every write in the system goes through one of these functions.
-- Each call is one transaction. Lock order is always item row, then claim rows, then order rows,
-- so concurrent calls cannot deadlock.
--
-- Errors use SQLSTATE class PH: PH403 forbidden, PH404 not found, PH409 wrong state, PH422 invalid.

create type app.claim_outcome as enum (
    'held',        -- you have it: pay within the hold window (free items are settled at once)
    'waitlisted',  -- every unit is held or sold; you are in line
    'already',     -- you already hold, won or are queued for this item
    'replay',      -- the same chat message seen before (webhook retry): the original decision
    'hold_limit',  -- too many unpaid holds in this drop
    'no_item',     -- nothing pinned and no valid code
    'closed',      -- the item is not open for claims
    'not_live',    -- the drop is not running
    'blocked'      -- the shop refuses claims from this buyer
);

create type app.claim_result as (
    outcome app.claim_outcome,
    claim_id uuid,
    order_id uuid,
    item_id uuid,
    item_code text,
    item_title text,
    claim_position int,
    status claim_status,
    hold_expires_at timestamptz,
    units_left int,
    waitlist_length int
);

create type app.gateway_outcome as enum ('paid', 'already_paid', 'late', 'unknown_order');

-- =============================================================================================
-- Helpers
-- =============================================================================================

create function app.require_staff(p_seller_id uuid, p_staff_id uuid, p_owner_only boolean default false)
returns void language plpgsql stable as $$
begin
    if not exists (
        select 1 from seller_staff s
        where s.seller_id = p_seller_id and s.staff_id = p_staff_id
          and (not p_owner_only or s.role = 'owner')
    ) then
        raise exception using errcode = 'PH403', message = 'You are not on this shop''s team.';
    end if;
end $$;

create function app.log(
    p_kind text, p_seller_id uuid, p_live_id uuid, p_item_id uuid, p_buyer_id uuid,
    p_claim_id uuid, p_order_id uuid, p_data jsonb default '{}'::jsonb
) returns void language sql as $$
    insert into events (kind, seller_id, live_id, item_id, buyer_id, claim_id, order_id, data)
    values (p_kind, p_seller_id, p_live_id, p_item_id, p_buyer_id, p_claim_id, p_order_id, p_data);
$$;

create function app.enqueue(p_kind text, p_payload jsonb, p_dedupe_key text default null)
returns void language sql as $$
    insert into outbox (kind, payload, dedupe_key) values (p_kind, p_payload, p_dedupe_key)
    on conflict (dedupe_key) do nothing;
$$;

-- One pending room sync per drop. The worker clears the key when it leases the job, so a change
-- made while a sync is running queues a fresh one instead of being lost.
create function app.enqueue_room_sync(p_live_id uuid) returns void language sql as $$
    select app.enqueue('room.sync', jsonb_build_object('live_id', p_live_id), 'room.sync:' || p_live_id);
$$;

create function app.units_taken(p_item_id uuid) returns int language sql stable as $$
    select count(*)::int from claims where item_id = p_item_id and status in ('held', 'paid');
$$;

create function app.waitlist_length(p_item_id uuid) returns int language sql stable as $$
    select count(*)::int from claims where item_id = p_item_id and status = 'waitlisted';
$$;

-- =============================================================================================
-- People and sessions
-- =============================================================================================

create function app.upsert_google_staff(p_google_sub text, p_email text, p_name text, p_avatar_url text)
returns staff language sql as $$
    insert into staff (google_sub, email, display_name, avatar_url)
    values (p_google_sub, lower(trim(p_email)), left(trim(p_name), 80), p_avatar_url)
    on conflict (email) do update
        set google_sub = coalesce(staff.google_sub, excluded.google_sub),
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url
    returning *;
$$;

create function app.upsert_phone_staff(p_firebase_uid text, p_phone text, p_name text)
returns staff language sql as $$
    insert into staff (firebase_uid, phone_e164, display_name)
    values (p_firebase_uid, p_phone, left(coalesce(nullif(trim(p_name), ''), 'Seller'), 80))
    on conflict (phone_e164) do update set firebase_uid = excluded.firebase_uid
    returning *;
$$;

-- Development sign-in only; the API refuses it unless PEHLE_DEV_LOGIN is set.
create function app.upsert_dev_staff(p_email text, p_name text) returns staff language sql as $$
    insert into staff (email, display_name) values (lower(trim(p_email)), left(trim(p_name), 80))
    on conflict (email) do update set display_name = excluded.display_name
    returning *;
$$;

-- The public name defaults to first name and last initial ("Priya S.").
create function app.upsert_google_buyer(p_google_sub text, p_email text, p_name text, p_avatar_url text)
returns buyers language sql as $$
    insert into buyers (google_sub, email, display_name, avatar_url)
    values (p_google_sub, lower(trim(p_email)), left(trim(p_name), 40), p_avatar_url)
    on conflict (google_sub) do update set email = excluded.email, avatar_url = excluded.avatar_url
    returning *;
$$;

create function app.upsert_phone_buyer(p_firebase_uid text, p_phone text, p_name text)
returns buyers language sql as $$
    insert into buyers (firebase_uid, phone_e164, display_name)
    values (p_firebase_uid, p_phone, left(coalesce(nullif(trim(p_name), ''), 'Buyer ' || right(p_phone, 4)), 40))
    on conflict (phone_e164) do update set firebase_uid = excluded.firebase_uid
    returning *;
$$;

-- Plain buyers exist for development sign-in and tests; real buyers come from Google or phone.
create function app.create_buyer(p_name text, p_language text default 'en', p_demo boolean default false)
returns buyers language sql as $$
    insert into buyers (display_name, preferred_language, is_demo)
    values (left(trim(p_name), 40), p_language, p_demo)
    returning *;
$$;

create function app.rename_buyer(p_buyer_id uuid, p_name text, p_language text) returns buyers language plpgsql as $$
declare
    v_buyer buyers;
begin
    update buyers set display_name = left(trim(p_name), 40), preferred_language = p_language
    where id = p_buyer_id returning * into v_buyer;
    if not found then
        raise exception using errcode = 'PH404', message = 'Buyer not found.';
    end if;
    return v_buyer;
end $$;

create function app.create_session(
    p_token_hash bytea, p_buyer_id uuid, p_staff_id uuid, p_user_agent text, p_ttl interval
) returns void language sql as $$
    insert into sessions (token_hash, buyer_id, staff_id, user_agent, expires_at)
    values (p_token_hash, p_buyer_id, p_staff_id, left(p_user_agent, 300), now() + p_ttl);
$$;

-- Resolve a session. Touches the session and the buyer's last-seen time at most once a minute.
create function app.session_principal(p_token_hash bytea, out buyer_id uuid, out staff_id uuid)
language plpgsql as $$
#variable_conflict use_column
declare
    v_stale boolean;
begin
    select s.buyer_id, s.staff_id, s.last_used_at < now() - interval '1 minute'
      into buyer_id, staff_id, v_stale
      from sessions s where s.token_hash = p_token_hash and s.expires_at > now();
    if v_stale then
        update sessions set last_used_at = now() where token_hash = p_token_hash;
        if buyer_id is not null then
            update buyers set last_seen_at = now() where id = buyer_id;
        end if;
    end if;
end $$;

create function app.delete_session(p_token_hash bytea) returns void language sql as $$
    delete from sessions where token_hash = p_token_hash;
$$;

-- =============================================================================================
-- Shops
-- =============================================================================================

create function app.create_shop(
    p_staff_id uuid, p_handle text, p_display_name text, p_upi_vpa text, p_upi_payee_name text,
    p_category text default 'other', p_city text default null
) returns sellers language plpgsql as $$
declare
    v_seller sellers;
begin
    insert into sellers (handle, display_name, upi_vpa, upi_payee_name, category, city)
    values (lower(trim(p_handle)), trim(p_display_name), nullif(trim(p_upi_vpa), ''),
            nullif(trim(p_upi_payee_name), ''), coalesce(p_category, 'other'), nullif(trim(p_city), ''))
    returning * into v_seller;
    insert into seller_staff (seller_id, staff_id, role) values (v_seller.id, p_staff_id, 'owner');
    perform app.log('shop.created', v_seller.id, null, null, null, null, null,
                    jsonb_build_object('handle', v_seller.handle));
    perform app.enqueue('shop.provision', jsonb_build_object('seller_id', v_seller.id),
                        'shop.provision:' || v_seller.id);
    return v_seller;
exception
    when unique_violation then
        raise exception using errcode = 'PH409', message = 'That shop handle is taken.';
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the handle, category, city and UPI ID.';
end $$;

create function app.update_shop(
    p_seller_id uuid, p_staff_id uuid, p_display_name text, p_tagline text, p_category text, p_city text,
    p_upi_vpa text, p_upi_payee_name text, p_hold_minutes int, p_max_holds_per_buyer int, p_policies jsonb
) returns sellers language plpgsql as $$
declare
    v_seller sellers;
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    update sellers set
        display_name = trim(p_display_name),
        tagline = nullif(trim(p_tagline), ''),
        category = p_category,
        city = nullif(trim(p_city), ''),
        upi_vpa = nullif(trim(p_upi_vpa), ''),
        upi_payee_name = nullif(trim(p_upi_payee_name), ''),
        hold_minutes = p_hold_minutes,
        max_holds_per_buyer = p_max_holds_per_buyer,
        policies = coalesce(p_policies, '{}'::jsonb)
    where id = p_seller_id
    returning * into v_seller;
    return v_seller;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the shop details: name, category, city, UPI ID and hold time.';
end $$;

create function app.set_shop_image(p_seller_id uuid, p_staff_id uuid, p_kind text, p_path text)
returns void language plpgsql as $$
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    if p_kind = 'avatar' then
        update sellers set avatar_path = p_path where id = p_seller_id;
    elsif p_kind = 'cover' then
        update sellers set cover_path = p_path where id = p_seller_id;
    else
        raise exception using errcode = 'PH422', message = 'Unknown image kind.';
    end if;
end $$;

create function app.block_buyer(p_seller_id uuid, p_staff_id uuid, p_buyer_id uuid) returns void language plpgsql as $$
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    insert into blocked_buyers (seller_id, buyer_id, blocked_by) values (p_seller_id, p_buyer_id, p_staff_id)
    on conflict do nothing;
    if found then
        perform app.log('buyer.blocked', p_seller_id, null, null, p_buyer_id, null, null,
                        jsonb_build_object('by', p_staff_id));
    end if;
end $$;

create function app.unblock_buyer(p_seller_id uuid, p_staff_id uuid, p_buyer_id uuid) returns void language plpgsql as $$
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    delete from blocked_buyers where seller_id = p_seller_id and buyer_id = p_buyer_id;
end $$;

create function app.save_payment_account(
    p_seller_id uuid, p_staff_id uuid, p_key_id text, p_key_secret_enc bytea, p_webhook_secret_enc bytea
) returns void language plpgsql as $$
begin
    perform app.require_staff(p_seller_id, p_staff_id, true);
    insert into seller_payment_accounts (seller_id, provider, key_id, key_secret_enc, webhook_secret_enc, connected_by)
    values (p_seller_id, 'razorpay', p_key_id, p_key_secret_enc, p_webhook_secret_enc, p_staff_id)
    on conflict (seller_id) do update set key_id = excluded.key_id, key_secret_enc = excluded.key_secret_enc,
        webhook_secret_enc = excluded.webhook_secret_enc, connected_by = excluded.connected_by, connected_at = now();
    perform app.log('payments.connected', p_seller_id, null, null, null, null, null,
                    jsonb_build_object('key_id', p_key_id));
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'That does not look like a Razorpay key ID.';
end $$;

create function app.delete_payment_account(p_seller_id uuid, p_staff_id uuid) returns void language plpgsql as $$
begin
    perform app.require_staff(p_seller_id, p_staff_id, true);
    delete from seller_payment_accounts where seller_id = p_seller_id;
    perform app.log('payments.disconnected', p_seller_id, null, null, null, null, null);
end $$;

-- =============================================================================================
-- Catalogue
-- =============================================================================================

create function app.create_item(
    p_seller_id uuid, p_staff_id uuid, p_code text, p_title text, p_description text, p_price_paise bigint,
    p_quantity int, p_image_path text, p_gallery_paths text[], p_winner_note text
) returns items language plpgsql as $$
declare
    v_item items;
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    insert into items (seller_id, code, title, description, price_paise, quantity, image_path, gallery_paths, winner_note)
    values (p_seller_id, upper(trim(p_code)), trim(p_title), nullif(trim(p_description), ''), p_price_paise,
            p_quantity, p_image_path, coalesce(p_gallery_paths, '{}'), nullif(trim(p_winner_note), ''))
    returning * into v_item;
    return v_item;
exception
    when unique_violation then
        raise exception using errcode = 'PH409', message = format('Code %s is already used in this shop.', upper(trim(p_code)));
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the code (letters and digits, up to 8), price and quantity.';
end $$;

-- Quantity can grow at any time but cannot drop below units already held or sold. Null image or
-- gallery arguments keep the current photos.
create function app.update_item(
    p_item_id uuid, p_staff_id uuid, p_code text, p_title text, p_description text, p_price_paise bigint,
    p_quantity int, p_image_path text, p_gallery_paths text[], p_winner_note text
) returns items language plpgsql as $$
declare
    v_item items;
    v_taken int;
begin
    select * into v_item from items where id = p_item_id for update;
    if not found or v_item.archived_at is not null then
        raise exception using errcode = 'PH404', message = 'Item not found.';
    end if;
    perform app.require_staff(v_item.seller_id, p_staff_id);
    v_taken := app.units_taken(p_item_id);
    if p_quantity < v_taken then
        raise exception using errcode = 'PH422', message = format('%s units are already held or sold.', v_taken);
    end if;
    update items set
        code = upper(trim(p_code)), title = trim(p_title), description = nullif(trim(p_description), ''),
        price_paise = p_price_paise, quantity = p_quantity,
        image_path = coalesce(p_image_path, image_path),
        gallery_paths = coalesce(p_gallery_paths, gallery_paths),
        winner_note = nullif(trim(p_winner_note), '')
    where id = p_item_id
    returning * into v_item;
    -- More stock may free units for people on the waitlist.
    perform app.promote_waitlist(p_item_id);
    if v_item.open_live_id is not null then
        perform app.enqueue_room_sync(v_item.open_live_id);
    end if;
    return v_item;
exception
    when unique_violation then
        raise exception using errcode = 'PH409', message = format('Code %s is already used in this shop.', upper(trim(p_code)));
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the code (letters and digits, up to 8), price and quantity.';
end $$;

create function app.archive_item(p_item_id uuid, p_staff_id uuid) returns void language plpgsql as $$
declare
    v_item items;
begin
    select * into v_item from items where id = p_item_id for update;
    if not found or v_item.archived_at is not null then
        raise exception using errcode = 'PH404', message = 'Item not found.';
    end if;
    perform app.require_staff(v_item.seller_id, p_staff_id);
    if v_item.status = 'open' then
        raise exception using errcode = 'PH409', message = 'Close the item in the drop before removing it.';
    end if;
    update items set archived_at = now() where id = p_item_id;
    delete from live_lineup l using lives v
     where l.item_id = p_item_id and v.id = l.live_id and v.status = 'draft';
end $$;

-- =============================================================================================
-- Drops
-- =============================================================================================

-- Validate and store when a drop starts, what it says and which items are in it.
create function app.write_drop_details(
    p_live lives, p_scheduled_for timestamptz, p_description text, p_item_ids uuid[]
) returns void language plpgsql as $$
begin
    if p_scheduled_for is not null and p_live.status = 'draft' and p_scheduled_for < now() - interval '1 hour' then
        raise exception using errcode = 'PH422', message = 'Pick a start time in the future.';
    end if;
    if cardinality(coalesce(p_item_ids, '{}')) > 60 then
        raise exception using errcode = 'PH422', message = 'A drop can list up to 60 items.';
    end if;
    if exists (
        select 1 from unnest(coalesce(p_item_ids, '{}')) as wanted(id)
        left join items i on i.id = wanted.id and i.seller_id = p_live.seller_id and i.archived_at is null
        where i.id is null
    ) then
        raise exception using errcode = 'PH422', message = 'Some items are not in this shop''s catalogue.';
    end if;
    update lives set scheduled_for = p_scheduled_for, description = nullif(trim(p_description), '')
    where id = p_live.id;
    delete from live_lineup where live_id = p_live.id;
    insert into live_lineup (live_id, item_id, sort)
    select p_live.id, id, min(ord)::int from unnest(coalesce(p_item_ids, '{}')) with ordinality as t(id, ord)
    group by id;
end $$;

create function app.create_live(
    p_seller_id uuid, p_staff_id uuid, p_title text, p_stream_url text, p_youtube_video_id text,
    p_description text default null, p_scheduled_for timestamptz default null, p_item_ids uuid[] default '{}'
) returns lives language plpgsql as $$
declare
    v_live lives;
begin
    perform app.require_staff(p_seller_id, p_staff_id);
    for attempt in 1..5 loop
        begin
            insert into lives (seller_id, slug, title, stream_url, youtube_video_id)
            values (p_seller_id, substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
                    trim(p_title), nullif(trim(p_stream_url), ''), p_youtube_video_id)
            returning * into v_live;
            exit;
        exception when unique_violation then
            v_live := null; -- slug collision: try another
        end;
    end loop;
    if v_live.id is null then
        raise exception using errcode = 'PH409', message = 'Could not allocate a drop link. Try again.';
    end if;
    perform app.write_drop_details(v_live, p_scheduled_for, p_description, p_item_ids);
    perform app.log('live.created', p_seller_id, v_live.id, null, null, null, null,
                    jsonb_build_object('slug', v_live.slug, 'scheduled_for', p_scheduled_for));
    select * into v_live from lives where id = v_live.id;
    return v_live;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the title and stream link (it must start with https://).';
end $$;

create function app.update_live(
    p_live_id uuid, p_staff_id uuid, p_title text, p_stream_url text, p_youtube_video_id text,
    p_description text, p_scheduled_for timestamptz, p_item_ids uuid[]
) returns lives language plpgsql as $$
declare
    v_live lives;
begin
    select * into v_live from lives where id = p_live_id for update;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    perform app.require_staff(v_live.seller_id, p_staff_id);
    if v_live.status = 'ended' then
        raise exception using errcode = 'PH409', message = 'This drop has ended.';
    end if;
    update lives set
        title = trim(p_title),
        stream_url = nullif(trim(p_stream_url), ''),
        youtube_live_chat_id = case when youtube_video_id is distinct from p_youtube_video_id then null else youtube_live_chat_id end,
        youtube_page_token = case when youtube_video_id is distinct from p_youtube_video_id then null else youtube_page_token end,
        youtube_video_id = p_youtube_video_id
    where id = p_live_id
    returning * into v_live;
    perform app.write_drop_details(v_live, p_scheduled_for, p_description, p_item_ids);
    perform app.enqueue_room_sync(p_live_id);
    select * into v_live from lives where id = p_live_id;
    return v_live;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the title and stream link (it must start with https://).';
end $$;

-- Called after the Nexconn open channel exists. Notifies reminder holders and the shop's club.
create function app.start_live(p_live_id uuid, p_staff_id uuid) returns lives language plpgsql as $$
declare
    v_live lives;
begin
    select * into v_live from lives where id = p_live_id for update;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    perform app.require_staff(v_live.seller_id, p_staff_id);
    if v_live.status <> 'draft' then
        raise exception using errcode = 'PH409', message = 'This drop has already started.';
    end if;
    begin
        update lives set status = 'live', started_at = now() where id = p_live_id returning * into v_live;
    exception when unique_violation then
        raise exception using errcode = 'PH409', message = 'End your other drop first.';
    end;
    perform app.log('live.started', v_live.seller_id, v_live.id, null, null, null, null);
    perform app.enqueue_room_sync(v_live.id);
    perform app.enqueue('shop.announce_live', jsonb_build_object('live_id', v_live.id), 'shop.announce_live:' || v_live.id);
    perform app.enqueue('drop.notify', jsonb_build_object('live_id', v_live.id), 'drop.notify:' || v_live.id);
    return v_live;
end $$;

-- Ending a drop stops new claims. Holds and waitlists carry on, so the hour after the live still sells.
create function app.end_live(p_live_id uuid, p_staff_id uuid) returns lives language plpgsql as $$
declare
    v_live lives;
begin
    select * into v_live from lives where id = p_live_id for update;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    perform app.require_staff(v_live.seller_id, p_staff_id);
    if v_live.status <> 'live' then
        raise exception using errcode = 'PH409', message = 'This drop is not running.';
    end if;
    update items set status = 'closed', open_live_id = null where open_live_id = p_live_id;
    update lives set status = 'ended', ended_at = now(), pinned_item_id = null where id = p_live_id
        returning * into v_live;
    perform app.log('live.ended', v_live.seller_id, v_live.id, null, null, null, null);
    perform app.enqueue_room_sync(v_live.id);
    perform app.enqueue('drop.report', jsonb_build_object('live_id', v_live.id), 'drop.report:' || v_live.id);
    return v_live;
end $$;

-- Open an item for claims and pin it as the one "mine" refers to.
create function app.drop_item(p_live_id uuid, p_item_id uuid, p_staff_id uuid) returns items language plpgsql as $$
declare
    v_live lives;
    v_item items;
begin
    select * into v_live from lives where id = p_live_id for update;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    perform app.require_staff(v_live.seller_id, p_staff_id);
    if v_live.status <> 'live' then
        raise exception using errcode = 'PH409', message = 'Start the drop before opening items.';
    end if;
    select * into v_item from items where id = p_item_id for update;
    if not found or v_item.seller_id <> v_live.seller_id or v_item.archived_at is not null then
        raise exception using errcode = 'PH404', message = 'Item not found in this shop.';
    end if;
    if v_item.status = 'open' and v_item.open_live_id <> p_live_id then
        raise exception using errcode = 'PH409', message = 'This item is open in another drop.';
    end if;
    update items set status = 'open', open_live_id = p_live_id where id = p_item_id returning * into v_item;
    update lives set pinned_item_id = p_item_id where id = p_live_id;
    perform app.log('item.dropped', v_live.seller_id, p_live_id, p_item_id, null, null, null,
                    jsonb_build_object('code', v_item.code));
    perform app.enqueue('room.drop', jsonb_build_object('live_id', p_live_id, 'item_id', p_item_id));
    perform app.enqueue_room_sync(p_live_id);
    return v_item;
end $$;

-- Stop new claims for an item. Existing holds and the waitlist stay.
create function app.close_item(p_live_id uuid, p_item_id uuid, p_staff_id uuid) returns items language plpgsql as $$
declare
    v_live lives;
    v_item items;
begin
    select * into v_live from lives where id = p_live_id;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    perform app.require_staff(v_live.seller_id, p_staff_id);
    select * into v_item from items where id = p_item_id for update;
    if not found or v_item.open_live_id is distinct from p_live_id then
        raise exception using errcode = 'PH409', message = 'This item is not open in this drop.';
    end if;
    update items set status = 'closed', open_live_id = null where id = p_item_id returning * into v_item;
    update lives set pinned_item_id = null where id = p_live_id and pinned_item_id = p_item_id;
    perform app.log('item.closed', v_live.seller_id, p_live_id, p_item_id, null, null, null);
    perform app.enqueue_room_sync(p_live_id);
    return v_item;
end $$;

-- Toggle "Remind me". Returns true when the buyer will be reminded.
create function app.toggle_reminder(p_live_id uuid, p_buyer_id uuid) returns boolean language plpgsql as $$
declare
    v_status live_status;
begin
    select status into v_status from lives where id = p_live_id;
    if not found then
        raise exception using errcode = 'PH404', message = 'Drop not found.';
    end if;
    if v_status = 'ended' then
        raise exception using errcode = 'PH409', message = 'This drop has ended.';
    end if;
    delete from drop_reminders where live_id = p_live_id and buyer_id = p_buyer_id;
    if found then
        return false;
    end if;
    insert into drop_reminders (live_id, buyer_id) values (p_live_id, p_buyer_id);
    return true;
end $$;

-- Everyone to tell that a drop started: reminder holders first, then the shop's club. Marks the
-- reminders as sent so a retried job does not notify twice.
create function app.take_drop_audience(p_live_id uuid) returns table (buyer_id uuid, reminded boolean)
language plpgsql as $$
#variable_conflict use_column
begin
    return query
    with marked as (
        update drop_reminders r set notified_at = now()
        where r.live_id = p_live_id and r.notified_at is null
        returning r.buyer_id
    )
    select m.buyer_id, true from marked m
    union
    select f.buyer_id, false from followers f
    join lives l on l.id = p_live_id and l.seller_id = f.seller_id
    where not exists (select 1 from drop_reminders r where r.live_id = p_live_id and r.buyer_id = f.buyer_id);
end $$;

create function app.set_youtube_chat(p_live_id uuid, p_live_chat_id text, p_page_token text) returns void
language sql as $$
    update lives set youtube_live_chat_id = p_live_chat_id, youtube_page_token = p_page_token, youtube_checked_at = now()
    where id = p_live_id;
$$;

-- =============================================================================================
-- Claims
-- =============================================================================================

create function app.claim_result_for(p_outcome app.claim_outcome, p_claim_id uuid, p_item_id uuid)
returns app.claim_result language sql stable as $$
    select p_outcome, c.id, o.id, i.id, i.code, i.title, c.position, c.status, c.hold_expires_at,
           greatest(i.quantity - app.units_taken(i.id), 0), app.waitlist_length(i.id)
    from items i
    left join claims c on c.id = p_claim_id
    left join orders o on o.claim_id = c.id
    where i.id = p_item_id;
$$;

create function app.claim_result_empty(p_outcome app.claim_outcome)
returns app.claim_result language sql immutable as $$
    select row(p_outcome, null, null, null, null, null, null, null, null, null, null)::app.claim_result;
$$;

-- Create the order for a hold. A free item (a giveaway) is settled on the spot: the claim is won
-- and the buyer gets the winner note without paying. Caller holds the item row lock.
create function app.issue_order(p_claim_id uuid, p_promoted boolean) returns uuid language plpgsql as $$
declare
    v_claim claims;
    v_item items;
    v_order_id uuid;
begin
    select * into v_claim from claims where id = p_claim_id;
    select * into v_item from items where id = v_claim.item_id;
    if v_item.price_paise = 0 then
        update claims set status = 'paid', closed_at = now() where id = p_claim_id;
        insert into orders (claim_id, seller_id, buyer_id, item_id, live_id, amount_paise, status, paid_via, paid_at, closed_at)
        values (p_claim_id, v_item.seller_id, v_claim.buyer_id, v_item.id, v_claim.live_id, 0, 'paid', 'free', now(), now())
        returning id into v_order_id;
        perform app.log('order.paid', v_item.seller_id, v_claim.live_id, v_item.id, v_claim.buyer_id, p_claim_id,
                        v_order_id, jsonb_build_object('amount_paise', 0, 'via', 'free'));
        perform app.enqueue('checkout.paid', jsonb_build_object('order_id', v_order_id), 'checkout.paid:' || v_order_id);
    else
        insert into orders (claim_id, seller_id, buyer_id, item_id, live_id, amount_paise)
        values (p_claim_id, v_item.seller_id, v_claim.buyer_id, v_item.id, v_claim.live_id, v_item.price_paise)
        returning id into v_order_id;
        perform app.enqueue('checkout.open', jsonb_build_object('order_id', v_order_id, 'promoted', p_promoted),
                            'checkout.open:' || v_order_id);
    end if;
    return v_order_id;
end $$;

-- Give the next waitlisted buyers a hold while units are free. Caller holds the item row lock.
create function app.promote_waitlist(p_item_id uuid) returns setof uuid language plpgsql as $$
declare
    v_item items;
    v_hold_minutes int;
    v_next claims;
    v_order_id uuid;
begin
    select * into v_item from items where id = p_item_id;
    select hold_minutes into v_hold_minutes from sellers where id = v_item.seller_id;
    loop
        exit when app.units_taken(p_item_id) >= v_item.quantity;
        select * into v_next from claims
        where item_id = p_item_id and status = 'waitlisted'
        order by position limit 1
        for update;
        exit when not found;

        update claims set status = 'held', held_at = now(), hold_expires_at = now() + make_interval(mins => v_hold_minutes)
        where id = v_next.id;
        v_order_id := app.issue_order(v_next.id, true);
        perform app.log('claim.promoted', v_item.seller_id, v_next.live_id, p_item_id, v_next.buyer_id,
                        v_next.id, v_order_id, jsonb_build_object('position', v_next.position));
        perform app.enqueue_room_sync(v_next.live_id);
        return next v_next.id;
    end loop;
end $$;

-- Decide a claim. Sources: the open_channel:pre_messaging webhook ('chat'), the claim button
-- ('button'), YouTube live chat ('youtube') and staff on a buyer's behalf ('seller').
create function app.claim(
    p_live_id uuid,
    p_buyer_id uuid,
    p_item_code text,
    p_source claim_source,
    p_said text,
    p_message_id text,
    p_received_at timestamptz
) returns app.claim_result language plpgsql as $$
declare
    v_live lives;
    v_seller sellers;
    v_item items;
    v_existing claims;
    v_item_id uuid;
    v_status claim_status;
    v_position int;
    v_claim_id uuid;
    v_order_id uuid := null;
    v_outcome app.claim_outcome;
begin
    -- Webhook retries deliver the same message again: return the original decision.
    if p_message_id is not null then
        select * into v_existing from claims where nexconn_message_id = p_message_id;
        if found then
            return app.claim_result_for('replay', v_existing.id, v_existing.item_id);
        end if;
    end if;

    select * into v_live from lives where id = p_live_id;
    if not found or v_live.status <> 'live' then
        return app.claim_result_empty('not_live');
    end if;
    select * into v_seller from sellers where id = v_live.seller_id;
    if exists (select 1 from blocked_buyers where seller_id = v_seller.id and buyer_id = p_buyer_id) then
        return app.claim_result_empty('blocked');
    end if;

    if p_item_code is not null and p_item_code <> '' then
        select id into v_item_id from items
        where seller_id = v_live.seller_id and code = upper(p_item_code) and archived_at is null;
    else
        v_item_id := v_live.pinned_item_id;
    end if;
    if v_item_id is null then
        return app.claim_result_empty('no_item');
    end if;

    -- Serialise every claim on this item. This lock is the whole fairness guarantee.
    select * into v_item from items where id = v_item_id for update;
    if v_item.status <> 'open' or v_item.open_live_id is distinct from p_live_id then
        return app.claim_result_for('closed', null, v_item.id);
    end if;

    select * into v_existing from claims
    where item_id = v_item.id and buyer_id = p_buyer_id and status in ('held', 'waitlisted', 'paid');
    if found then
        return app.claim_result_for('already', v_existing.id, v_item.id);
    end if;

    if app.units_taken(v_item.id) < v_item.quantity then
        if v_item.price_paise > 0 and (select count(*) from claims
            where live_id = p_live_id and buyer_id = p_buyer_id and status = 'held') >= v_seller.max_holds_per_buyer then
            return app.claim_result_for('hold_limit', null, v_item.id);
        end if;
        v_status := 'held';
    else
        v_status := 'waitlisted';
    end if;

    update items set claim_seq = claim_seq + 1 where id = v_item.id returning claim_seq into v_position;

    insert into claims (item_id, live_id, buyer_id, position, status, source, said,
                        nexconn_message_id, nexconn_received_at, held_at, hold_expires_at)
    values (v_item.id, p_live_id, p_buyer_id, v_position, v_status, p_source, left(p_said, 500),
            p_message_id, p_received_at,
            case when v_status = 'held' then now() end,
            case when v_status = 'held' then now() + make_interval(mins => v_seller.hold_minutes) end)
    returning id into v_claim_id;

    if v_status = 'held' then
        v_order_id := app.issue_order(v_claim_id, false);
        v_outcome := 'held';
    else
        v_outcome := 'waitlisted';
    end if;

    perform app.log('claim.' || v_outcome::text, v_seller.id, p_live_id, v_item.id, p_buyer_id, v_claim_id,
                    v_order_id, jsonb_build_object(
                        'position', v_position, 'source', p_source, 'said', left(p_said, 120),
                        'nexconn_message_id', p_message_id, 'nexconn_received_at', p_received_at));
    -- Pehle chat claims are rewritten in place by the webhook reply; every other source gets a posted receipt.
    if p_source <> 'chat' then
        perform app.enqueue('room.receipt', jsonb_build_object('claim_id', v_claim_id));
    end if;
    perform app.enqueue_room_sync(p_live_id);

    return app.claim_result_for(v_outcome, v_claim_id, v_item.id);
end $$;

-- Expire unpaid holds and promote the next buyer. Safe to run from several workers at once.
create function app.expire_due_holds(p_limit int default 100)
returns table (expired_claim_id uuid, item_id uuid, live_id uuid) language plpgsql as $$
#variable_conflict use_column
declare
    r record;
    v_claim claims;
    v_seller_id uuid;
    v_order_id uuid;
begin
    for r in
        select c.id, c.item_id from claims c
        join orders o on o.claim_id = c.id
        where c.status = 'held' and c.hold_expires_at <= now() and o.status = 'awaiting_payment'
        order by c.hold_expires_at
        limit p_limit
    loop
        -- Item first (the global lock order); skip items another transaction is working on.
        select i.seller_id into v_seller_id from items i where i.id = r.item_id for update skip locked;
        continue when not found;
        select * into v_claim from claims c where c.id = r.id for update;
        continue when v_claim.status <> 'held' or v_claim.hold_expires_at > now();
        select o.id into v_order_id from orders o where o.claim_id = r.id and o.status = 'awaiting_payment' for update;
        continue when not found;

        update claims c set status = 'expired', closed_at = now() where c.id = r.id;
        update orders o set status = 'expired', closed_at = now() where o.id = v_order_id;
        perform app.log('hold.expired', v_seller_id, v_claim.live_id, r.item_id, v_claim.buyer_id, r.id, v_order_id,
                        jsonb_build_object('position', v_claim.position));
        perform app.enqueue('checkout.expired', jsonb_build_object('claim_id', r.id, 'order_id', v_order_id));
        perform app.promote_waitlist(r.item_id);
        perform app.enqueue_room_sync(v_claim.live_id);

        expired_claim_id := r.id;
        item_id := r.item_id;
        live_id := v_claim.live_id;
        return next;
    end loop;
end $$;

-- Buyer gives up a hold or leaves the waitlist.
create function app.release_claim(p_claim_id uuid, p_buyer_id uuid) returns claims language plpgsql as $$
declare
    v_claim claims;
begin
    select * into v_claim from claims where id = p_claim_id;
    if not found or v_claim.buyer_id <> p_buyer_id then
        raise exception using errcode = 'PH404', message = 'Claim not found.';
    end if;
    perform 1 from items where id = v_claim.item_id for update;
    select * into v_claim from claims where id = p_claim_id for update;
    if v_claim.status not in ('held', 'waitlisted') then
        raise exception using errcode = 'PH409', message = 'This claim is already closed.';
    end if;
    if exists (select 1 from orders where claim_id = p_claim_id and status = 'payment_reported') then
        raise exception using errcode = 'PH409', message = 'Payment was reported; ask the shop to cancel.';
    end if;
    update claims set status = 'released', closed_at = now() where id = p_claim_id returning * into v_claim;
    update orders set status = 'cancelled', closed_at = now() where claim_id = p_claim_id and status = 'awaiting_payment';
    perform app.log('claim.released', (select seller_id from items where id = v_claim.item_id), v_claim.live_id,
                    v_claim.item_id, p_buyer_id, p_claim_id, null);
    perform app.promote_waitlist(v_claim.item_id);
    perform app.enqueue_room_sync(v_claim.live_id);
    return v_claim;
end $$;

-- =============================================================================================
-- Orders and payments
-- =============================================================================================

-- Manual UPI: the buyer reports the UTR with delivery details; the seller confirms in the studio.
create function app.report_payment(
    p_order_id uuid, p_buyer_id uuid, p_upi_reference text,
    p_ship_name text, p_ship_phone text, p_ship_address text, p_ship_pincode text
) returns orders language plpgsql as $$
declare
    v_order orders;
    v_claim claims;
begin
    select * into v_order from orders where id = p_order_id;
    if not found or v_order.buyer_id <> p_buyer_id then
        raise exception using errcode = 'PH404', message = 'Order not found.';
    end if;
    perform 1 from items where id = v_order.item_id for update;
    select * into v_claim from claims where id = v_order.claim_id for update;
    select * into v_order from orders where id = p_order_id for update;
    if v_order.status <> 'awaiting_payment' or v_claim.status <> 'held' then
        raise exception using errcode = 'PH409', message = 'This order is no longer waiting for payment.';
    end if;
    if v_claim.hold_expires_at <= now() then
        raise exception using errcode = 'PH409', message = 'Your hold ran out before the payment was reported.';
    end if;
    update orders set status = 'payment_reported', payment_reported_at = now(),
        upi_reference = trim(p_upi_reference), ship_name = trim(p_ship_name),
        ship_phone = regexp_replace(p_ship_phone, '[^0-9+]', '', 'g'),
        ship_address = trim(p_ship_address), ship_pincode = trim(p_ship_pincode)
    where id = p_order_id returning * into v_order;
    perform app.log('order.payment_reported', v_order.seller_id, v_order.live_id, v_order.item_id,
                    p_buyer_id, v_order.claim_id, p_order_id);
    perform app.enqueue('checkout.payment_reported', jsonb_build_object('order_id', p_order_id));
    return v_order;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the UPI reference, phone and pincode.';
end $$;

-- Seller confirmations are labelled as such, so the fairness log shows how each order was verified.
create function app.confirm_payment(p_order_id uuid, p_staff_id uuid) returns orders language plpgsql as $$
declare
    v_order orders;
begin
    select * into v_order from orders where id = p_order_id;
    if not found then
        raise exception using errcode = 'PH404', message = 'Order not found.';
    end if;
    perform app.require_staff(v_order.seller_id, p_staff_id);
    perform 1 from items where id = v_order.item_id for update;
    perform 1 from claims where id = v_order.claim_id for update;
    select * into v_order from orders where id = p_order_id for update;
    if v_order.status not in ('awaiting_payment', 'payment_reported') then
        raise exception using errcode = 'PH409', message = 'This order is already closed.';
    end if;
    update claims set status = 'paid', closed_at = now() where id = v_order.claim_id;
    update orders set status = 'paid', paid_at = now(), closed_at = now(), paid_via = 'seller_confirmed'
    where id = p_order_id returning * into v_order;
    perform app.log('order.paid', v_order.seller_id, v_order.live_id, v_order.item_id, v_order.buyer_id,
                    v_order.claim_id, p_order_id, jsonb_build_object('amount_paise', v_order.amount_paise,
                                                                     'via', 'seller_confirmed', 'confirmed_by', p_staff_id));
    perform app.enqueue('checkout.paid', jsonb_build_object('order_id', p_order_id), 'checkout.paid:' || p_order_id);
    perform app.enqueue_room_sync(v_order.live_id);
    return v_order;
end $$;

-- Seller cancels (wrong reference, buyer unreachable). The next buyer is promoted.
create function app.cancel_order(p_order_id uuid, p_staff_id uuid, p_reason text) returns orders language plpgsql as $$
declare
    v_order orders;
begin
    select * into v_order from orders where id = p_order_id;
    if not found then
        raise exception using errcode = 'PH404', message = 'Order not found.';
    end if;
    perform app.require_staff(v_order.seller_id, p_staff_id);
    perform 1 from items where id = v_order.item_id for update;
    perform 1 from claims where id = v_order.claim_id for update;
    select * into v_order from orders where id = p_order_id for update;
    if v_order.status not in ('awaiting_payment', 'payment_reported') then
        raise exception using errcode = 'PH409', message = 'This order is already closed.';
    end if;
    update claims set status = 'cancelled', closed_at = now() where id = v_order.claim_id;
    update orders set status = 'cancelled', closed_at = now() where id = p_order_id returning * into v_order;
    perform app.log('order.cancelled', v_order.seller_id, v_order.live_id, v_order.item_id, v_order.buyer_id,
                    v_order.claim_id, p_order_id, jsonb_build_object('reason', left(p_reason, 200), 'cancelled_by', p_staff_id));
    perform app.enqueue('checkout.cancelled', jsonb_build_object('order_id', p_order_id));
    perform app.promote_waitlist(v_order.item_id);
    perform app.enqueue_room_sync(v_order.live_id);
    return v_order;
end $$;

-- Delivery details can be given before paying (gateway orders) or with the payment report.
create function app.set_shipping(
    p_order_id uuid, p_buyer_id uuid, p_ship_name text, p_ship_phone text, p_ship_address text, p_ship_pincode text
) returns orders language plpgsql as $$
declare
    v_order orders;
begin
    update orders set ship_name = trim(p_ship_name),
        ship_phone = regexp_replace(p_ship_phone, '[^0-9+]', '', 'g'),
        ship_address = trim(p_ship_address), ship_pincode = trim(p_ship_pincode)
    where id = p_order_id and buyer_id = p_buyer_id and status in ('awaiting_payment', 'payment_reported', 'paid')
    returning * into v_order;
    if not found then
        raise exception using errcode = 'PH409', message = 'This order is no longer open.';
    end if;
    return v_order;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'Check the phone number and pincode.';
end $$;

create function app.set_payment_link(p_order_id uuid, p_link_id text, p_url text) returns void language sql as $$
    update orders set payment_link_id = p_link_id, payment_link_url = p_url where id = p_order_id;
$$;

-- The gateway reports money received. If the hold is still open the order is paid; if it lapsed
-- (the item may belong to someone else now) a refund is queued.
create function app.gateway_paid(p_order_id uuid, p_payment_id text, p_rrn text, p_amount_paise bigint)
returns app.gateway_outcome language plpgsql as $$
declare
    v_order orders;
    v_claim claims;
begin
    select * into v_order from orders where id = p_order_id;
    if not found then
        return 'unknown_order';
    end if;
    perform 1 from items where id = v_order.item_id for update;
    select * into v_claim from claims where id = v_order.claim_id for update;
    select * into v_order from orders where id = p_order_id for update;
    if v_order.status = 'paid' then
        return 'already_paid';
    end if;
    if v_order.status not in ('awaiting_payment', 'payment_reported') or v_claim.status <> 'held'
       or p_amount_paise < v_order.amount_paise then
        update orders set gateway_payment_id = coalesce(gateway_payment_id, p_payment_id),
                          gateway_rrn = coalesce(gateway_rrn, p_rrn)
        where id = p_order_id;
        perform app.log('payment.late', v_order.seller_id, v_order.live_id, v_order.item_id, v_order.buyer_id,
                        v_order.claim_id, p_order_id, jsonb_build_object('payment_id', p_payment_id,
                        'amount_paise', p_amount_paise, 'order_status', v_order.status));
        perform app.enqueue('payment.refund', jsonb_build_object('order_id', p_order_id, 'payment_id', p_payment_id,
                            'amount_paise', p_amount_paise), 'payment.refund:' || p_payment_id);
        return 'late';
    end if;
    update claims set status = 'paid', closed_at = now() where id = v_order.claim_id;
    update orders set status = 'paid', paid_at = now(), closed_at = now(), paid_via = 'gateway',
                      gateway_payment_id = p_payment_id, gateway_rrn = p_rrn,
                      upi_reference = coalesce(upi_reference, case when char_length(p_rrn) between 6 and 40 then p_rrn end)
    where id = p_order_id;
    perform app.log('order.paid', v_order.seller_id, v_order.live_id, v_order.item_id, v_order.buyer_id,
                    v_order.claim_id, p_order_id, jsonb_build_object('amount_paise', p_amount_paise, 'via', 'gateway',
                                                                     'payment_id', p_payment_id));
    perform app.enqueue('checkout.paid', jsonb_build_object('order_id', p_order_id), 'checkout.paid:' || p_order_id);
    perform app.enqueue_room_sync(v_order.live_id);
    return 'paid';
end $$;

create function app.set_refund(p_order_id uuid, p_refund_id text, p_reason text) returns void language plpgsql as $$
declare
    v_order orders;
begin
    update orders set refund_id = p_refund_id, refund_reason = left(p_reason, 200) where id = p_order_id
    returning * into v_order;
    perform app.log('payment.refunded', v_order.seller_id, v_order.live_id, v_order.item_id, v_order.buyer_id,
                    v_order.claim_id, p_order_id, jsonb_build_object('refund_id', p_refund_id));
end $$;

-- =============================================================================================
-- Audience: the club, conversations and push
-- =============================================================================================

create function app.follow(p_seller_id uuid, p_buyer_id uuid) returns boolean language plpgsql as $$
begin
    insert into followers (seller_id, buyer_id) values (p_seller_id, p_buyer_id) on conflict do nothing;
    if not found then
        return false;
    end if;
    perform app.log('shop.followed', p_seller_id, null, null, p_buyer_id, null, null);
    perform app.enqueue('shop.join', jsonb_build_object('seller_id', p_seller_id, 'buyer_id', p_buyer_id),
                        'shop.join:' || p_seller_id || ':' || p_buyer_id);
    return true;
end $$;

create function app.unfollow(p_seller_id uuid, p_buyer_id uuid) returns boolean language plpgsql as $$
begin
    delete from followers where seller_id = p_seller_id and buyer_id = p_buyer_id;
    if not found then
        return false;
    end if;
    perform app.enqueue('shop.leave', jsonb_build_object('seller_id', p_seller_id, 'buyer_id', p_buyer_id));
    return true;
end $$;

-- The buyer↔shop conversation, created on first use and provisioned on Nexconn by the outbox.
create function app.ensure_conversation(p_seller_id uuid, p_buyer_id uuid) returns conversations
language plpgsql as $$
declare
    v_conversation conversations;
begin
    insert into conversations (seller_id, buyer_id) values (p_seller_id, p_buyer_id)
    on conflict (seller_id, buyer_id) do nothing
    returning * into v_conversation;
    if found then
        perform app.enqueue('conversation.provision', jsonb_build_object('conversation_id', v_conversation.id),
                            'conversation.provision:' || v_conversation.id);
        return v_conversation;
    end if;
    select * into v_conversation from conversations where seller_id = p_seller_id and buyer_id = p_buyer_id;
    return v_conversation;
end $$;

create function app.conversation_provisioned(p_conversation_id uuid) returns void language sql as $$
    update conversations set provisioned_at = coalesce(provisioned_at, now()) where id = p_conversation_id;
$$;

create function app.touch_conversation(p_nexconn_group_id text) returns void language sql as $$
    update conversations set last_activity_at = now() where nexconn_group_id = p_nexconn_group_id;
$$;

create function app.save_push_subscription(
    p_endpoint text, p_buyer_id uuid, p_staff_id uuid, p_p256dh text, p_auth text, p_user_agent text
) returns void language plpgsql as $$
begin
    insert into push_subscriptions (endpoint, buyer_id, staff_id, p256dh, auth, user_agent)
    values (p_endpoint, p_buyer_id, p_staff_id, p_p256dh, p_auth, left(p_user_agent, 300))
    on conflict (endpoint) do update set buyer_id = excluded.buyer_id, staff_id = excluded.staff_id,
        p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failures = 0;
exception
    when check_violation then
        raise exception using errcode = 'PH422', message = 'This browser sent an invalid push subscription.';
end $$;

create function app.delete_push_subscription(p_endpoint text) returns void language sql as $$
    delete from push_subscriptions where endpoint = p_endpoint;
$$;

-- Record a delivery attempt. Gone endpoints (404/410) and endpoints failing five times are dropped.
create function app.push_delivered(p_endpoint text, p_ok boolean, p_gone boolean) returns void language plpgsql as $$
begin
    if p_gone then
        delete from push_subscriptions where endpoint = p_endpoint;
    elsif p_ok then
        update push_subscriptions set last_success_at = now(), failures = 0 where endpoint = p_endpoint;
    else
        update push_subscriptions set failures = failures + 1 where endpoint = p_endpoint;
        delete from push_subscriptions where endpoint = p_endpoint and failures >= 5;
    end if;
end $$;

-- =============================================================================================
-- YouTube live chat
-- =============================================================================================

-- The buyer for a YouTube commenter: a linked buyer, or a placeholder named after the YouTube
-- account until someone links it.
create function app.youtube_buyer(p_channel_id text, p_name text) returns uuid language plpgsql as $$
declare
    v_id uuid;
begin
    select id into v_id from buyers where youtube_channel_id = p_channel_id;
    if found then
        return v_id;
    end if;
    insert into buyers (display_name, youtube_channel_id, youtube_name)
    values (left(coalesce(nullif(trim(p_name), ''), 'YouTube viewer'), 40), p_channel_id, left(p_name, 80))
    on conflict (youtube_channel_id) do update set youtube_name = excluded.youtube_name
    returning id into v_id;
    return v_id;
end $$;

-- A fresh four-digit code for "pehle 1234", valid for ten minutes in this drop.
create function app.issue_youtube_code(p_live_id uuid, p_buyer_id uuid) returns youtube_link_codes
language plpgsql as $$
declare
    v_code youtube_link_codes;
begin
    delete from youtube_link_codes where expires_at < now() or (live_id = p_live_id and buyer_id = p_buyer_id);
    for attempt in 1..20 loop
        insert into youtube_link_codes (live_id, code, buyer_id, expires_at)
        values (p_live_id, (1000 + floor(random() * 9000))::int::text, p_buyer_id, now() + interval '10 minutes')
        on conflict do nothing
        returning * into v_code;
        if found then
            return v_code;
        end if;
    end loop;
    raise exception using errcode = 'PH409', message = 'Could not issue a code. Try again.';
end $$;

-- Link a YouTube channel to a signed-in buyer who typed their code in that channel's chat. A
-- placeholder buyer for the channel is merged: its claims and orders move to the real buyer.
create function app.link_youtube(p_live_id uuid, p_code text, p_channel_id text, p_name text) returns uuid language plpgsql as $$
declare
    v_buyer uuid;
    v_placeholder uuid;
begin
    delete from youtube_link_codes where live_id = p_live_id and code = p_code and expires_at > now()
    returning buyer_id into v_buyer;
    if v_buyer is null then
        return null;
    end if;
    select id into v_placeholder from buyers
    where youtube_channel_id = p_channel_id and id <> v_buyer
      and google_sub is null and phone_e164 is null and not is_demo;
    if v_placeholder is not null then
        -- Where both identities claimed the same item, keep the earlier place in line.
        update claims c set status = 'cancelled', closed_at = now()
        where c.buyer_id = v_placeholder and c.status in ('held', 'waitlisted')
          and exists (select 1 from claims o where o.buyer_id = v_buyer and o.item_id = c.item_id
                      and o.status in ('held', 'waitlisted', 'paid') and o.position < c.position);
        update claims o set status = 'cancelled', closed_at = now()
        where o.buyer_id = v_buyer and o.status in ('held', 'waitlisted')
          and exists (select 1 from claims c where c.buyer_id = v_placeholder and c.item_id = o.item_id
                      and c.status in ('held', 'waitlisted', 'paid') and c.position < o.position);
        update orders set status = 'cancelled', closed_at = now()
        where claim_id in (select id from claims where buyer_id in (v_buyer, v_placeholder) and status = 'cancelled')
          and status in ('awaiting_payment', 'payment_reported');
        update claims set buyer_id = v_buyer where buyer_id = v_placeholder;
        update orders set buyer_id = v_buyer where buyer_id = v_placeholder;
        delete from buyers where id = v_placeholder;
    end if;
    update buyers set youtube_channel_id = null where youtube_channel_id = p_channel_id and id <> v_buyer;
    update buyers set youtube_channel_id = p_channel_id, youtube_name = left(p_name, 80) where id = v_buyer;
    perform app.log('buyer.youtube_linked', (select seller_id from lives where id = p_live_id), p_live_id, null, v_buyer,
                    null, null, jsonb_build_object('youtube_name', p_name, 'merged', v_placeholder is not null));
    return v_buyer;
end $$;

-- =============================================================================================
-- AI co-host approvals
-- =============================================================================================

create function app.request_approval(
    p_seller_id uuid, p_live_id uuid, p_buyer_id uuid, p_kind text, p_question text, p_proposed_reply text
) returns uuid language plpgsql as $$
declare
    v_id uuid;
begin
    insert into approvals (seller_id, live_id, buyer_id, kind, question, proposed_reply)
    values (p_seller_id, p_live_id, p_buyer_id, p_kind, left(p_question, 1000), left(p_proposed_reply, 1000))
    returning id into v_id;
    perform app.log('approval.requested', p_seller_id, p_live_id, null, p_buyer_id, null, null,
                    jsonb_build_object('approval_id', v_id, 'kind', p_kind));
    return v_id;
end $$;

create function app.decide_approval(p_approval_id uuid, p_staff_id uuid, p_approve boolean, p_reply text)
returns approvals language plpgsql as $$
declare
    v_approval approvals;
begin
    select * into v_approval from approvals where id = p_approval_id for update;
    if not found then
        raise exception using errcode = 'PH404', message = 'Request not found.';
    end if;
    perform app.require_staff(v_approval.seller_id, p_staff_id);
    if v_approval.status <> 'pending' then
        raise exception using errcode = 'PH409', message = 'This request was already answered.';
    end if;
    update approvals set status = case when p_approve then 'approved'::approval_status else 'declined'::approval_status end,
        decided_at = now(), decided_by = p_staff_id,
        proposed_reply = coalesce(nullif(trim(p_reply), ''), proposed_reply)
    where id = p_approval_id returning * into v_approval;
    perform app.log('approval.' || v_approval.status::text, v_approval.seller_id, v_approval.live_id, null,
                    v_approval.buyer_id, null, null, jsonb_build_object('approval_id', p_approval_id, 'by', p_staff_id));
    return v_approval;
end $$;

-- =============================================================================================
-- Outbox, webhooks and housekeeping
-- =============================================================================================

-- Lease due jobs. `p_cohost_lane` selects co-host jobs (slow model calls) or everything else.
create function app.lease_jobs(p_limit int, p_lease_seconds double precision, p_max_attempts int, p_cohost_lane boolean)
returns table (id bigint, kind text, payload jsonb, attempts int) language sql as $$
    update outbox o set
        locked_until = now() + make_interval(secs => p_lease_seconds),
        attempts = o.attempts + 1,
        dedupe_key = case when o.kind = 'room.sync' then null else o.dedupe_key end
    where o.id in (
        select q.id from outbox q
        where q.done_at is null and q.attempts < p_max_attempts and q.run_after <= now()
          and (q.locked_until is null or q.locked_until < now())
          and (q.kind like 'cohost.%') = p_cohost_lane
        order by q.id
        limit p_limit
        for update skip locked)
    returning o.id, o.kind, o.payload, o.attempts;
$$;

create function app.complete_job(p_id bigint) returns void language sql as $$
    update outbox set done_at = now(), locked_until = null, last_error = null where id = p_id;
$$;

create function app.fail_job(p_id bigint, p_error text, p_backoff_seconds double precision) returns void language sql as $$
    update outbox set locked_until = null, last_error = left(p_error, 2000),
                      run_after = now() + make_interval(secs => p_backoff_seconds)
    where id = p_id;
$$;

-- Record a webhook event ID. Returns false when it was already processed.
create function app.first_sighting(p_event_id text, p_kind text) returns boolean language plpgsql as $$
begin
    insert into webhook_events (event_id, kind) values (p_event_id, p_kind) on conflict do nothing;
    return found;
end $$;

-- Analytics events from the API (room joins, chat presence).
create function app.record_event(p_kind text, p_seller_id uuid, p_live_id uuid, p_buyer_id uuid, p_data jsonb)
returns void language sql as $$
    select app.log(p_kind, p_seller_id, p_live_id, null, p_buyer_id, null, null, coalesce(p_data, '{}'::jsonb));
$$;

create function app.housekeeping() returns jsonb language plpgsql as $$
declare
    v_sessions int;
    v_webhooks int;
    v_jobs int;
begin
    delete from sessions where expires_at < now();
    get diagnostics v_sessions = row_count;
    delete from webhook_events where received_at < now() - interval '3 days';
    get diagnostics v_webhooks = row_count;
    delete from outbox where done_at < now() - interval '7 days';
    get diagnostics v_jobs = row_count;
    delete from youtube_link_codes where expires_at < now();
    return jsonb_build_object('sessions', v_sessions, 'webhookEvents', v_webhooks, 'jobs', v_jobs);
end $$;

-- =============================================================================================
-- Room state, written to the open channel's metadata so every viewer sees the same numbers
-- =============================================================================================

create function app.item_state(p_item_id uuid) returns jsonb language sql stable as $$
    select jsonb_build_object(
        'id', i.id, 'code', i.code, 'title', i.title, 'pricePaise', i.price_paise,
        'imagePath', i.image_path, 'quantity', i.quantity, 'status', i.status,
        'held', (select count(*) from claims c where c.item_id = i.id and c.status = 'held'),
        'paid', (select count(*) from claims c where c.item_id = i.id and c.status = 'paid'),
        'left', greatest(i.quantity - app.units_taken(i.id), 0),
        'waitlist', app.waitlist_length(i.id))
    from items i where i.id = p_item_id;
$$;

create function app.live_snapshot(p_live_id uuid) returns jsonb language sql stable as $$
    select jsonb_build_object(
        'v', 1,
        'status', l.status,
        'title', l.title,
        'streamUrl', l.stream_url,
        'pinned', case when l.pinned_item_id is null then null else app.item_state(l.pinned_item_id) end,
        'open', coalesce((select jsonb_agg(app.item_state(i.id) order by i.code)
                          from items i where i.open_live_id = l.id), '[]'::jsonb),
        'claims', (select count(*) from claims c where c.live_id = l.id),
        'at', floor(extract(epoch from clock_timestamp()) * 1000)::bigint)
    from lives l where l.id = p_live_id;
$$;

-- =============================================================================================
-- Demo shop for judges and new sellers
-- =============================================================================================

-- Create (once) the public demo shop owned by the given staff account.
create function app.setup_demo_shop(p_staff_id uuid) returns sellers language plpgsql as $$
declare
    v_seller sellers;
begin
    select * into v_seller from sellers where handle = 'pehle-demo';
    if found then
        return v_seller;
    end if;
    v_seller := app.create_shop(p_staff_id, 'pehle-demo', 'Pehle demo drop', null, null, 'thrift', 'Online');
    update sellers set is_demo = true, hold_minutes = 3, max_holds_per_buyer = 2,
        tagline = 'Try a real drop: race four rival buyers for one piece.',
        policies = jsonb_build_object('shipping', 'This is a demo. Nothing ships and no money moves.',
                                      'cod', 'No cash on delivery in the demo.')
    where id = v_seller.id returning * into v_seller;
    return v_seller;
end $$;

-- A private practice shop for someone trying the seller side (one per practice account). Practice
-- shops are hidden from browsing and only practice buyers can claim in them.
create function app.create_practice_shop(p_staff_id uuid) returns sellers language plpgsql as $$
declare
    v_seller sellers;
begin
    select s.* into v_seller from sellers s join seller_staff m on m.seller_id = s.id
     where m.staff_id = p_staff_id and s.is_demo limit 1;
    if found then
        return v_seller;
    end if;
    v_seller := app.create_shop(p_staff_id, 'try-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
                                'My practice shop', null, null, 'thrift', 'Online');
    update sellers set is_demo = true, hold_minutes = 3,
        tagline = 'Practice shop: open your drop link in another browser and race yourself.'
    where id = v_seller.id returning * into v_seller;
    return v_seller;
end $$;

-- Scripted rival buyers. They are never given chat tokens.
create function app.demo_bots() returns setof buyers language plpgsql as $$
declare
    v_name text;
begin
    foreach v_name in array array['Priya S.', 'Rahul K.', 'Ananya M.', 'Kabir J.'] loop
        if not exists (select 1 from buyers where is_bot and display_name = v_name) then
            insert into buyers (display_name, is_demo, is_bot) values (v_name, true, true);
        end if;
    end loop;
    return query select * from buyers where is_bot order by display_name;
end $$;

-- Make a scripted rival miss their payment window now, so a judge sees the waitlist move without
-- waiting minutes. Refuses anything outside the demo shop.
create function app.demo_lapse_hold(p_claim_id uuid) returns boolean language plpgsql as $$
begin
    update claims c set hold_expires_at = clock_timestamp()
      from items i, sellers s, buyers b
     where c.id = p_claim_id and c.status = 'held'
       and i.id = c.item_id and s.id = i.seller_id and s.is_demo
       and b.id = c.buyer_id and b.is_bot;
    return found;
end $$;
