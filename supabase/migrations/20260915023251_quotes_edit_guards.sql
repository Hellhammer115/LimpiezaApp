-- Fix round 1 on apply_quote_edit (20260915022658_quotes.sql):
--
-- 1. Reject duplicate item ids in p_items. Previously the ownership check
--    (a join) still passed when the same id appeared twice, because each
--    duplicate joins the same order_items row; the subsequent
--    `update ... from jsonb_array_elements(p_items)` then had two source
--    rows matching one target row, which Postgres applies non-deterministically.
-- 2. Range-check p_discount_percent (0-100) inside the function so an
--    out-of-range value raises the function's own Spanish error instead of
--    falling through to the column check constraint's raw Postgres error.
create or replace function public.apply_quote_edit(
  p_order_id         uuid,
  p_items            jsonb,
  p_delivery_fee_cents integer,
  p_discount_cents   integer,
  p_discount_percent smallint,
  p_admin_note       text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_subtotal integer;
  v_discount integer;
  v_count    integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if v_order.status not in ('quote_requested', 'quote_sent') then
    raise exception 'La cotización ya no se puede editar' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización debe tener al menos un producto' using errcode = 'P0001';
  end if;
  if p_delivery_fee_cents < 0 or p_discount_cents < 0 then
    raise exception 'Montos inválidos' using errcode = 'P0001';
  end if;
  if p_discount_percent is not null and (p_discount_percent < 0 or p_discount_percent > 100) then
    raise exception 'Montos inválidos' using errcode = 'P0001';
  end if;

  -- Reject duplicate item ids before the ownership check: a duplicate id
  -- would still pass the join-based count below (each copy joins the same
  -- row), then make the subsequent bulk UPDATE's source-to-target match
  -- ambiguous between the two duplicate rows.
  if (select count(distinct e->>'id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
    raise exception 'Producto repetido en la cotización' using errcode = 'P0001';
  end if;

  -- Every submitted id must belong to this order.
  select count(*) into v_count
  from jsonb_array_elements(p_items) e
  join public.order_items oi on oi.id = (e->>'id')::uuid and oi.order_id = p_order_id;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'Producto inválido en la cotización' using errcode = 'P0001';
  end if;

  update public.order_items oi
  set quantity         = (e->>'quantity')::integer,
      unit_price_cents = (e->>'unit_price_cents')::integer
  from jsonb_array_elements(p_items) e
  where oi.id = (e->>'id')::uuid and oi.order_id = p_order_id;

  delete from public.order_items oi
  where oi.order_id = p_order_id
    and oi.id not in (select (e->>'id')::uuid from jsonb_array_elements(p_items) e);

  select coalesce(sum(quantity * unit_price_cents), 0) into v_subtotal
  from public.order_items where order_id = p_order_id;

  if p_discount_percent is not null then
    v_discount := round(v_subtotal * p_discount_percent / 100.0);
  else
    v_discount := p_discount_cents;
  end if;
  if v_discount > v_subtotal then
    raise exception 'El descuento no puede superar el subtotal' using errcode = 'P0001';
  end if;

  update public.orders
  set subtotal_cents     = v_subtotal,
      discount_cents     = v_discount,
      discount_percent   = p_discount_percent,
      delivery_fee_cents = p_delivery_fee_cents,
      total_cents        = greatest(v_subtotal - v_discount + p_delivery_fee_cents, 0),
      admin_note         = nullif(btrim(coalesce(p_admin_note, '')), ''),
      mp_preference_id   = null,
      mp_init_point      = null,
      updated_at         = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Same hardening as 20260911231900_revoke_public_execute.sql. create or
-- replace preserves the existing ACL, but this is restated to document
-- intent explicitly.
revoke execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  from public, anon, authenticated;
grant execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  to service_role;
