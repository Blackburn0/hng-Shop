-- Rollback for migrations/20261003090000_cart_versions_realtime.sql
--   1. Run in Supabase Dashboard > SQL Editor.
--   2. npx supabase migration repair --status reverted 20261003090000

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cart_versions'
  ) then
    alter publication supabase_realtime drop table public.cart_versions;
  end if;
end;
$$;

drop trigger if exists cart_items_bump_version on public.cart_items;
drop function if exists public.bump_cart_version();
drop table if exists public.cart_versions;
