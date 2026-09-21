-- Quote revisions: when an admin changes a cotización the customer already
-- received (status quote_sent), keep the version the customer last saw so the
-- app can show "anterior vs. actualizada" before they pay.
--
--   previous_quote       — snapshot (quote_snapshot + quoted_at) of the version
--                          the customer last saw.
--   quote_updated_at     — when the current version replaced it.
--   quote_update_seen_at — when the customer opened the updated quote
--                          (set by quote-actions `seen`).
--
-- If the admin edits again before the customer has looked, previous_quote is
-- kept, so the comparison is always against what the customer actually saw.
alter table public.orders
  add column previous_quote       jsonb,
  add column quote_updated_at     timestamptz,
  add column quote_update_seen_at timestamptz;

-- The customer-visible content of a quote. Items are ordered by id so two
-- snapshots of the same content compare equal.
create or replace function public.quote_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', oi.id,
                  'product_id', oi.product_id,
                  'name', oi.name,
                  'quantity', oi.quantity,
                  'unit_price_cents', oi.unit_price_cents
                ) order by oi.id)
       from public.order_items oi
       where oi.order_id = o.id),
      '[]'::jsonb),
    'subtotal_cents', o.subtotal_cents,
    'discount_cents', o.discount_cents,
    'discount_percent', o.discount_percent,
    'delivery_fee_cents', o.delivery_fee_cents,
    'total_cents', o.total_cents,
    'admin_note', o.admin_note
  )
  from public.orders o
  where o.id = p_order_id;
$$;

revoke execute on function public.quote_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.quote_snapshot(uuid) to service_role;

-- apply_quote_edit gains p_track_revision (default true). admin-orders
-- `create` passes false: applying the admin's prices to a brand-new quote is
-- not an update the customer has seen a previous version of.
drop function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text);

create function public.apply_quote_edit(
  p_order_id           uuid,
  p_items              jsonb,
  p_delivery_fee_cents integer,
  p_discount_cents     integer,
  p_discount_percent   smallint,
  p_admin_note         text,
  p_track_revision     boolean default true
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_before   jsonb;
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

  -- See 20260915023251_quotes_edit_guards.sql.
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

  -- Only a quote the customer already received has a "previous" version.
  if p_track_revision and v_order.status = 'quote_sent' then
    v_before := public.quote_snapshot(p_order_id);
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

  -- A save that changed nothing the customer sees is not an update.
  if v_before is not null and v_before <> public.quote_snapshot(p_order_id) then
    update public.orders
    set previous_quote = case
          -- Replace the snapshot only once the customer has seen the last
          -- update; otherwise keep the version they actually saw.
          when previous_quote is null or quote_update_seen_at >= quote_updated_at
            then v_before || jsonb_build_object('quoted_at', coalesce(quote_updated_at, quoted_at))
          else previous_quote
        end,
        quote_updated_at = now()
    where id = p_order_id
    returning * into v_order;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text, boolean)
  to service_role;
