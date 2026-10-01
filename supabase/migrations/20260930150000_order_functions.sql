-- Order creation and payment confirmation as single transactions.
-- Callable only with the service role (the API server).
-- Rollback: supabase/rollbacks/20260930150000_order_functions.down.sql

-- ---------------------------------------------------------------------------
-- create_order: price the user's cart from the products table and write the
-- order + items atomically. Raises hint 'empty_cart' when nothing is orderable.
-- Cash orders are confirmed immediately and the cart is emptied; card orders
-- keep the cart until payment succeeds (so a failed payment can be retried).
-- ---------------------------------------------------------------------------
create function public.create_order(
  p_user_id uuid,
  p_email text,
  p_payment_method public.payment_method,
  p_delivery_name text,
  p_delivery_phone text,
  p_delivery_address text,
  p_paystack_reference text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subtotal integer;
  v_order public.orders;
begin
  -- Serialise concurrent checkouts for the same user.
  perform 1 from public.cart_items where user_id = p_user_id for update;

  select coalesce(sum(p.price_minor * c.quantity), 0)::integer
    into v_subtotal
    from public.cart_items c
    join public.products p on p.id = c.product_id
   where c.user_id = p_user_id and p.is_active;

  if v_subtotal = 0 then
    raise exception 'cart is empty' using errcode = 'P0001', hint = 'empty_cart';
  end if;

  insert into public.orders (
    user_id, status, payment_method, subtotal_minor, total_minor, customer_email,
    delivery_name, delivery_phone, delivery_address, paystack_reference
  ) values (
    p_user_id,
    case when p_payment_method = 'cash' then 'cash_on_delivery' else 'pending_payment' end::public.order_status,
    p_payment_method,
    v_subtotal,
    v_subtotal, -- no delivery fee or discounts yet
    p_email,
    p_delivery_name,
    p_delivery_phone,
    p_delivery_address,
    p_paystack_reference
  )
  returning * into v_order;

  insert into public.order_items (order_id, product_id, product_name, unit_price_minor, quantity)
  select v_order.id, p.id, p.name, p.price_minor, c.quantity
    from public.cart_items c
    join public.products p on p.id = c.product_id
   where c.user_id = p_user_id and p.is_active;

  if p_payment_method = 'cash' then
    delete from public.cart_items where user_id = p_user_id;
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_order_paid: idempotent. Called by both the verify endpoint and the
-- webhook; only the first call transitions the order (transitioned = true).
-- Raises hint 'order_not_found' or 'amount_mismatch'.
-- ---------------------------------------------------------------------------
create function public.mark_order_paid(
  p_reference text,
  p_amount_minor integer,
  p_currency text,
  p_paid_at timestamptz
)
returns table (order_id uuid, transitioned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where paystack_reference = p_reference for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0001', hint = 'order_not_found';
  end if;

  if v_order.status = 'paid' then
    return query select v_order.id, false;
    return;
  end if;

  if v_order.total_minor <> p_amount_minor or v_order.currency <> p_currency then
    raise exception 'amount mismatch' using errcode = 'P0001', hint = 'amount_mismatch';
  end if;

  update public.orders
     set status = 'paid', paid_at = coalesce(p_paid_at, now())
   where id = v_order.id;

  -- Remove only what was bought; anything added to the cart since stays.
  delete from public.cart_items c
   using public.order_items oi
   where oi.order_id = v_order.id
     and c.user_id = v_order.user_id
     and c.product_id = oi.product_id;

  return query select v_order.id, true;
end;
$$;

revoke execute on function public.create_order(uuid, text, public.payment_method, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.mark_order_paid(text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, public.payment_method, text, text, text, text)
  to service_role;
grant execute on function public.mark_order_paid(text, integer, text, timestamptz)
  to service_role;
