-- Initial schema: profiles, products, cart, orders, payments, email log.
-- Rollback: supabase/rollbacks/20260930130000_initial_schema.down.sql
-- Money is stored as integer minor units (kobo) with a currency code.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.product_category as enum ('coffee', 'pastry');
create type public.order_status as enum ('pending_payment', 'paid', 'failed', 'cancelled', 'cash_on_delivery');
create type public.payment_method as enum ('card', 'cash');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created on first sign-in
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null check (char_length(name) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 2000),
  category     public.product_category not null,
  price_minor  integer not null check (price_minor > 0),
  currency     char(3) not null default 'NGN' check (currency = 'NGN'),
  image_url    text not null,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Supports the cursor-paginated listing (ordered by sort_order, id).
create index products_active_sort_idx on public.products (sort_order, id) where is_active;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cart_items — signed-in users' carts (guest carts live in localStorage)
-- ---------------------------------------------------------------------------
create table public.cart_items (
  user_id     uuid not null references auth.users (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  quantity    integer not null check (quantity between 1 and 99),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index cart_items_product_idx on public.cart_items (product_id);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders + order_items
-- ---------------------------------------------------------------------------
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  -- restrict: order history must not vanish if a user is deleted.
  user_id             uuid not null references auth.users (id) on delete restrict,
  status              public.order_status not null default 'pending_payment',
  payment_method      public.payment_method not null,
  currency            char(3) not null default 'NGN' check (currency = 'NGN'),
  subtotal_minor      integer not null check (subtotal_minor >= 0),
  total_minor         integer not null check (total_minor >= 0),
  customer_email      text not null,
  delivery_name       text not null check (char_length(delivery_name) between 1 and 120),
  delivery_phone      text not null check (char_length(delivery_phone) between 7 and 20),
  delivery_address    text not null check (char_length(delivery_address) between 5 and 500),
  paystack_reference  text unique,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint orders_card_has_reference check (payment_method = 'cash' or paystack_reference is not null),
  constraint orders_paid_has_timestamp check (status <> 'paid' or paid_at is not null),
  constraint orders_cash_status check (payment_method = 'card' or status in ('cash_on_delivery', 'cancelled'))
);

-- Supports "my orders" cursor pagination (newest first).
create index orders_user_created_idx on public.orders (user_id, created_at desc, id desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  -- set null: the name/price snapshot below keeps the order readable.
  product_id        uuid references public.products (id) on delete set null,
  product_name      text not null,
  unit_price_minor  integer not null check (unit_price_minor > 0),
  quantity          integer not null check (quantity between 1 and 99),
  line_total_minor  integer generated always as (unit_price_minor * quantity) stored
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- payment_events — raw webhook log; the unique key makes processing idempotent
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'paystack',
  event_id     text not null,
  event_type   text not null,
  reference    text,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);

create index payment_events_reference_idx on public.payment_events (reference);

-- ---------------------------------------------------------------------------
-- email_log — one row per (order, email type) so confirmations send once
-- ---------------------------------------------------------------------------
create table public.email_log (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  type                 text not null check (type in ('order_confirmation')),
  status               text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_message_id  text,
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (order_id, type)
);

create trigger email_log_set_updated_at
  before update on public.email_log
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Writes to orders, order_items, payment_events and email_log happen only on
-- the server with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.products       enable row level security;
alter table public.cart_items     enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payment_events enable row level security;
alter table public.email_log      enable row level security;

create policy "Active products are public"
  on public.products for select
  to anon, authenticated
  using (is_active);

create policy "Users read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users read own cart"
  on public.cart_items for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users add to own cart"
  on public.cart_items for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own cart"
  on public.cart_items for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users remove from own cart"
  on public.cart_items for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read own orders"
  on public.orders for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read own order items"
  on public.order_items for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  ));

-- payment_events and email_log: no policies — service role only.

-- ---------------------------------------------------------------------------
-- Grants (explicit, in case the project doesn't auto-expose new tables)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.products, public.cart_items, public.orders,
  public.order_items, public.payment_events, public.email_log from anon, authenticated;

grant select on public.products to anon, authenticated;
grant select on public.profiles, public.orders, public.order_items to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;

grant all on public.profiles, public.products, public.cart_items, public.orders,
  public.order_items, public.payment_events, public.email_log to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
