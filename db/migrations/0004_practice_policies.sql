-- Practice shops start with sample policies so the AI co-host has something real to answer from.
create function app.practice_policies() returns jsonb language sql immutable as $$
    select jsonb_build_object(
        'Shipping', 'Ships across India in 3 to 5 days. Free above ₹2,000, otherwise ₹80.',
        'Cash on delivery', 'No cash on delivery. UPI only.',
        'Returns', 'Exchange within 3 days for damage, with an unboxing video.',
        'Sizes', 'Sarees are 6.3 m with an unstitched blouse piece.')
$$;

create or replace function app.create_practice_shop(p_staff_id uuid) returns sellers language plpgsql as $$
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
        tagline = 'Practice shop: open your drop link in another browser and race yourself.',
        policies = app.practice_policies()
    where id = v_seller.id returning * into v_seller;
    return v_seller;
end $$;


update sellers set policies = app.practice_policies()
 where is_demo and handle like 'try-%' and policies = '{}'::jsonb;
