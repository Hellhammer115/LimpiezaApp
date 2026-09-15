-- Quote-first checkout, part 2/2: quote columns, admin read access, and the
-- atomic edit RPC. A cotización IS an orders row; "pedido" simply means
-- paid_at is not null. No client write policy is added — every write still
-- goes through Edge Functions with the service role.

alter table public.orders
  add column discount_cents   integer  not null default 0 check (discount_cents >= 0),
  add column discount_percent smallint check (discount_percent between 0 and 100),
  add column admin_note       text,
  add column customer_name    text     not null default '',
  add column customer_phone   text,
  add column customer_email   text     not null default '',
  add column paid_at          timestamptz,
  add column quoted_at        timestamptz,
  add column quoted_by        uuid references auth.users (id) on delete set null,
  add column mp_init_point    text;

-- Rows paid before this migration are pedidos: give them a paid_at.
update public.orders
set paid_at = updated_at
where paid_at is null
  and status in ('paid', 'preparing', 'delivering', 'delivered');

create index orders_paid_at_idx on public.orders (paid_at);

-- Original catalog price, kept beside the admin-editable unit_price_cents.
alter table public.order_items
  add column catalog_price_cents integer not null default 0
    check (catalog_price_cents >= 0);
update public.order_items set catalog_price_cents = unit_price_cents;

-- Admins read every order; the existing "select own" policies stay for customers.
create policy "orders: admin select all"
  on public.orders for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "order_items: admin select all"
  on public.order_items for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- apply_quote_edit: replaces the line items of an UNPAID quote and recomputes
-- every total in one transaction. Items missing from p_items are deleted.
-- p_items: [{ "id": uuid, "quantity": int, "unit_price_cents": int }, ...]
-- Called only by the admin-orders Edge Function (service role).
-- ---------------------------------------------------------------------------
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

-- Same hardening as 20260911231900_revoke_public_execute.sql.
revoke execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  from public, anon, authenticated;
grant execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  to service_role;
