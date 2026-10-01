-- Rollback for migrations/20260930130100_seed_products.sql
--   1. Run in Supabase Dashboard > SQL Editor.
--   2. npx supabase migration repair --status reverted 20260930130100
-- Products already referenced by order_items keep those orders readable via
-- the name/price snapshot (product_id is set to null).

delete from public.products
where slug in ('americano', 'cappuccino', 'yule-log-cake');
