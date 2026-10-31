-- Access control. The API process connects as the database owner only to run migrations; every
-- pooled connection then runs `set role pehle_api`. That role can read tables but cannot insert,
-- update or delete them. All writes go through app.* functions, which run as the owner
-- (security definer) with a pinned search path, so every rule in 0002_functions.sql is enforced
-- no matter how the API is called.
--
-- Row-level security is deliberately not used: the API is the only client and resolves the signed-in
-- buyer or seller itself, and each function checks ownership (app.require_staff, buyer_id matches).
-- Any later migration that adds functions must end by running app.harden().

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'pehle_api') then
        create role pehle_api nologin;
    end if;
end $$;

-- The connecting user must be a member of pehle_api to switch to it.
do $$
begin
    execute format('grant pehle_api to %I', current_user);
end $$;

create function app.harden() returns void language plpgsql as $$
declare
    f record;
begin
    for f in
        select p.oid::regprocedure as signature
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.prokind = 'f' and p.proname <> 'harden'
    loop
        execute format('alter function %s security definer set search_path = public, app, pg_temp', f.signature);
    end loop;
    revoke all on all tables in schema public from pehle_api;
    grant select on all tables in schema public to pehle_api;
    -- Payment secrets stay readable only through the API's decrypting code path, never listed.
    revoke all on seller_payment_accounts from pehle_api;
    grant select (seller_id, provider, key_id, key_secret_enc, webhook_secret_enc, live_mode, connected_at)
        on seller_payment_accounts to pehle_api;
    revoke all on all functions in schema app from public;
    grant usage on schema app to pehle_api;
    grant execute on all functions in schema app to pehle_api;
    revoke execute on function app.harden() from pehle_api;
end $$;

revoke all on schema public from public;
grant usage on schema public to pehle_api;
select app.harden();
