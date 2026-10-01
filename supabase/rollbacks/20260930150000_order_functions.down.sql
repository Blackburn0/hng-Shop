-- Rollback for migrations/20260930150000_order_functions.sql
--   1. Run in Supabase Dashboard > SQL Editor.
--   2. npx supabase migration repair --status reverted 20260930150000

drop function if exists public.mark_order_paid(text, integer, text, timestamptz);
drop function if exists public.create_order(uuid, text, public.payment_method, text, text, text, text);
