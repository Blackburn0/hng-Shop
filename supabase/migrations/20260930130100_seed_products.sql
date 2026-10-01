-- Catalogue from Design/Product Page.png. Prices converted to NGN (plan.md D1),
-- stored in kobo. Idempotent: re-running updates the rows in place.
-- Rollback: supabase/rollbacks/20260930130100_seed_products.down.sql

insert into public.products (slug, name, description, category, price_minor, image_url, sort_order)
values
  (
    'americano',
    'Americano',
    'The aroma of our Americano brewed with premium roasted coffee grounds and hot water. It has a velvety body, caramel-like aroma with an earthy flavour and bittersweet finish.',
    'coffee',
    350000,
    '/products/americano.jpg',
    10
  ),
  (
    'cappuccino',
    'Cappuccino',
    'With the richness and intensity of espresso, complemented by the creamy and velvety texture of steamed milk, offering a combination of strong coffee notes, subtle sweetness, and a touch of bitterness.',
    'coffee',
    420000,
    '/products/cappuccino.jpg',
    20
  ),
  (
    'yule-log-cake',
    'Yule Log Cake',
    'Taste a combination of sweet and rich flavours of our thin sheet of sponge cake filled with a creamy filling, chocolate ganache, buttercream and a cherry on top as a garnish.',
    'pastry',
    550000,
    '/products/yule-log-cake.jpg',
    30
  )
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category,
  price_minor = excluded.price_minor,
  image_url   = excluded.image_url,
  sort_order  = excluded.sort_order;
