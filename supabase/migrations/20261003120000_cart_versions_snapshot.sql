-- Put the cart's contents in the live signal, so clients can update straight
-- from the Realtime push instead of re-reading GET /api/v1/cart (one fewer
-- round trip to the API: ~1 s from Nigeria to the US-hosted functions).
-- Rollback: supabase/rollbacks/20261003120000_cart_versions_snapshot.down.sql

alter table public.cart_versions
  add column items jsonb not null default '[]'::jsonb;

comment on column public.cart_versions.items is
  'Snapshot of the user''s cart_items as [{productId, quantity}], oldest first. Prices and names come from the products API.';

-- Same trigger function as 20261003090000, now also storing the snapshot.
-- AFTER ROW triggers run once the statement has finished, so for a statement
-- touching several rows (a merge) the last bump carries the final cart.
create or replace function public.bump_cart_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_items jsonb;
begin
  if not exists (select 1 from auth.users where id = v_user) then
    return null;
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('productId', c.product_id, 'quantity', c.quantity)
                     order by c.created_at, c.product_id),
           '[]'::jsonb)
    into v_items
    from public.cart_items c
   where c.user_id = v_user;

  insert into public.cart_versions as cv (user_id, version, updated_at, items)
  values (v_user, 1, now(), v_items)
  on conflict (user_id) do update
    set version = cv.version + 1,
        updated_at = now(),
        items = excluded.items;
  return null;
end;
$$;

revoke execute on function public.bump_cart_version() from public, anon, authenticated;
