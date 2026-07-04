-- LimpiezaApp initial schema
-- Money is always integer cents (MXN). RLS is enabled on every table.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- PROFILES (password lives ONLY in auth.users, managed by Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  last_name  text not null default '',
  phone      text,
  email      text not null,
  photo_url  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Profile row is created automatically on signup (security definer trigger).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, name, last_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ADDRESSES
-- ---------------------------------------------------------------------------
create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null default 'Casa',
  street     text not null,
  colonia    text not null default '',
  city       text not null,
  zip        text not null default '',
  notes      text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index addresses_user_id_idx on public.addresses (user_id);

alter table public.addresses enable row level security;

create policy "addresses: select own"
  on public.addresses for select
  using (auth.uid() = user_id);

create policy "addresses: insert own"
  on public.addresses for insert
  with check (auth.uid() = user_id);

create policy "addresses: update own"
  on public.addresses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "addresses: delete own"
  on public.addresses for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- CATEGORIES (read-only for clients; writes only via service role)
-- ---------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon       text not null default 'pricetag-outline',
  sort_order integer not null default 0
);

alter table public.categories enable row level security;

create policy "categories: public read"
  on public.categories for select
  using (true);

-- ---------------------------------------------------------------------------
-- PRODUCTS (read-only for clients; writes only via service role)
-- ---------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name        text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  unit        text not null default 'pieza',
  image_url   text,
  stock       integer not null default 0 check (stock >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);

alter table public.products enable row level security;

create policy "products: public read active"
  on public.products for select
  using (is_active = true);

-- ---------------------------------------------------------------------------
-- ORDERS (clients can only READ their own orders; they are created and
-- updated exclusively by Edge Functions using the service role, so totals
-- and status can never be tampered with from the app)
-- ---------------------------------------------------------------------------
create type public.order_status as enum
  ('pending', 'paid', 'preparing', 'delivering', 'delivered', 'cancelled');

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id),
  address_id         uuid not null references public.addresses (id),
  status             public.order_status not null default 'pending',
  subtotal_cents     integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents        integer not null check (total_cents >= 0),
  delivery_slot      text not null,
  mp_preference_id   text,
  mp_payment_id      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index orders_user_id_idx on public.orders (user_id);
create unique index orders_mp_payment_id_idx
  on public.orders (mp_payment_id) where mp_payment_id is not null;

alter table public.orders enable row level security;

create policy "orders: select own"
  on public.orders for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ORDER ITEMS (price snapshot at purchase time)
-- ---------------------------------------------------------------------------
create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid not null references public.products (id),
  quantity         integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create index order_items_order_id_idx on public.order_items (order_id);

alter table public.order_items enable row level security;

create policy "order_items: select via own order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Atomically decrement stock for every item of a paid order (called by the
-- mp-webhook Edge Function with the service role).
create or replace function public.decrement_stock_for_order(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.products p
  set stock = greatest(p.stock - oi.quantity, 0)
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.product_id = p.id;
$$;

revoke execute on function public.decrement_stock_for_order(uuid) from anon, authenticated;
