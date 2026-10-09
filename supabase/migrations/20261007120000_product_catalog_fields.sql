-- Product master data from the supplier spreadsheet, plus a bulk-import path.
--
-- Spreadsheet column      -> products column
--   Clave                 -> sku               (new; unique, upsert key)
--   Clave SAT             -> sat_key           (new; SAT ClaveProdServ)
--   Categoria             -> category_id       (existing; matched by name)
--   Marca                 -> brand             (new)
--   Codigo                -> code              (new; kept as-is, meaning TBD vs Clave)
--   Piezas por caja       -> pieces_per_box    (new)
--   Nombre producto       -> name              (existing)
--   Precio por pieza      -> price_cents       (existing; the per-piece price)
--   Precio por docena     -> dozen_price_cents (new)

alter table public.products
  add column sku               text,
  add column sat_key           text,
  add column brand             text,
  add column code              text,
  add column pieces_per_box    integer check (pieces_per_box > 0),
  add column dozen_price_cents integer check (dozen_price_cents >= 0);

-- Nullable so products created before the import keep working; Postgres
-- allows many NULLs under a unique constraint.
alter table public.products
  add constraint products_sku_key unique (sku);

comment on column public.products.price_cents is 'Precio por pieza, en centavos.';
comment on column public.products.dozen_price_cents is 'Precio por docena, en centavos.';

-- ---------------------------------------------------------------------------
-- Staging table for spreadsheet imports. Every column is text so the
-- dashboard CSV import never rejects a row over formatting ("$1,234.50",
-- "12 pzas"); import_products() parses and validates. RLS with no policies:
-- only the dashboard / SQL editor (postgres) and the service role can touch it.
-- ---------------------------------------------------------------------------
create table public.product_import (
  clave             text,
  clave_sat         text,
  categoria         text,
  marca             text,
  codigo            text,
  piezas_por_caja   text,
  nombre_producto   text,
  precio_por_pieza  text,
  precio_por_docena text
);

alter table public.product_import enable row level security;

-- "$1,234.50" -> 123450; blank -> null.
create function public.parse_price_cents(raw text)
returns integer
language sql
immutable
as $$
  select case
    when nullif(btrim(raw), '') is null then null
    else round(regexp_replace(raw, '[^0-9.]', '', 'g')::numeric * 100)::integer
  end
$$;

-- Upserts every staged row into products (matched on sku = Clave), creating
-- any category it doesn't recognise, then empties the staging table.
-- Existing description, image, stock, unit and is_active are left untouched.
-- Raises (and imports nothing) if any row lacks a Clave, name or piece price.
create function public.import_products()
returns table (inserted integer, updated integer, categories_created integer)
language plpgsql
set search_path = public
as $$
declare
  bad text;
  new_categories integer;
  ins integer;
  upd integer;
begin
  select string_agg(coalesce(nullif(btrim(clave), ''), '(sin clave)'), ', ')
    into bad
    from product_import
   where nullif(btrim(clave), '') is null
      or nullif(btrim(nombre_producto), '') is null
      or nullif(btrim(categoria), '') is null
      or parse_price_cents(precio_por_pieza) is null;
  if bad is not null then
    raise exception 'Filas incompletas (clave, nombre, categoría y precio por pieza son obligatorios): %', bad;
  end if;

  select string_agg(btrim(clave), ', ')
    into bad
    from (select btrim(clave) as clave from product_import
          group by btrim(clave) having count(*) > 1) d;
  if bad is not null then
    raise exception 'Claves repetidas en el archivo: %', bad;
  end if;

  with names as (
    select distinct btrim(categoria) as name from product_import
  ), created as (
    insert into categories (name)
    select n.name from names n
     where not exists (
       select 1 from categories c where lower(c.name) = lower(n.name)
     )
    returning 1
  )
  select count(*) into new_categories from created;

  with upserted as (
    insert into products as p
      (sku, sat_key, category_id, brand, code, pieces_per_box, name,
       price_cents, dozen_price_cents, updated_at)
    select
      btrim(i.clave),
      nullif(btrim(i.clave_sat), ''),
      (select c.id from categories c
        where lower(c.name) = lower(btrim(i.categoria))
        order by c.is_active desc, c.sort_order
        limit 1),
      nullif(btrim(i.marca), ''),
      nullif(btrim(i.codigo), ''),
      nullif(regexp_replace(i.piezas_por_caja, '[^0-9]', '', 'g'), '')::integer,
      btrim(i.nombre_producto),
      parse_price_cents(i.precio_por_pieza),
      parse_price_cents(i.precio_por_docena),
      now()
    from product_import i
    on conflict (sku) do update set
      sat_key           = excluded.sat_key,
      category_id       = excluded.category_id,
      brand             = excluded.brand,
      code              = excluded.code,
      pieces_per_box    = excluded.pieces_per_box,
      name              = excluded.name,
      price_cents       = excluded.price_cents,
      dozen_price_cents = excluded.dozen_price_cents,
      updated_at        = now()
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert), count(*) filter (where not was_insert)
    into ins, upd
    from upserted;

  delete from product_import;

  return query select ins, upd, new_categories;
end;
$$;

-- Admin-only tooling, run from the SQL editor; never exposed over PostgREST.
revoke execute on function public.import_products() from public, anon, authenticated;
revoke execute on function public.parse_price_cents(text) from public, anon, authenticated;
