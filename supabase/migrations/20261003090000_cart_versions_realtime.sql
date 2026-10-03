-- Realtime "your cart changed" signal, one row per user.
-- Rollback: supabase/rollbacks/20261003090000_cart_versions_realtime.down.sql
--
-- Clients (web and mobile) subscribe to UPDATE/INSERT on their own row here and
-- then re-read GET /api/v1/cart. We don't subscribe to cart_items itself because
-- Supabase Realtime can't filter or RLS-check DELETE events per user, so a
-- removal would be broadcast to everyone. This table only ever gets inserts and
-- updates, which RLS restricts to the row's owner.

create table public.cart_versions (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now()
);

alter table public.cart_versions enable row level security;

create policy "Users read own cart version"
  on public.cart_versions for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.cart_versions from anon, authenticated;
grant select on public.cart_versions to authenticated;
grant all on public.cart_versions to service_role;

-- Bump the owner's version after any change to their cart.
create function public.bump_cart_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  -- When the user themself is being deleted, their cart rows cascade away;
  -- there is no one left to notify (and the FK would reject the insert).
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

create trigger cart_items_bump_version
  after insert or update or delete on public.cart_items
  for each row execute function public.bump_cart_version();

-- Broadcast changes to subscribed clients (the publication exists on Supabase).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cart_versions;
  end if;
end;
$$;
