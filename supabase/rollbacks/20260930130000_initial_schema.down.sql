-- Rollback for migrations/20260930130000_initial_schema.sql
-- DESTRUCTIVE: drops every app table and its data. To roll back:
--   1. Paste this file into Supabase Dashboard > SQL Editor and run it.
--   2. npx supabase migration repair --status reverted 20260930130000

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.email_log;
drop table if exists public.payment_events;
drop table if exists public.order_items;
drop table if exists public.orders;
drop table if exists public.cart_items;
drop table if exists public.products;
drop table if exists public.profiles;

drop function if exists public.set_updated_at();

drop type if exists public.payment_method;
drop type if exists public.order_status;
drop type if exists public.product_category;
