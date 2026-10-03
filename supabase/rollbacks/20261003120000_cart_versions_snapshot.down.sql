-- Rollback for migrations/20261003120000_cart_versions_snapshot.sql
--   1. Run in Supabase Dashboard > SQL Editor.
--   2. npx supabase migration repair --status reverted 20261003120000
-- Clients fall back to re-reading the cart when a push has no items.

create or replace function public.bump_cart_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  if not exists (select 1 from auth.users where id = v_user) then
    return null;
  end if;

  insert into public.cart_versions as cv (user_id, version, updated_at)
  values (v_user, 1, now())
  on conflict (user_id) do update
    set version = cv.version + 1,
        updated_at = now();
  return null;
end;
$$;

revoke execute on function public.bump_cart_version() from public, anon, authenticated;

alter table public.cart_versions drop column if exists items;
