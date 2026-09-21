-- Admin product management: admin_users table, audit columns on products,
-- and a public-read/admin-write storage bucket for product images.
-- products RLS is intentionally untouched by this migration.

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users: select own"
  on public.admin_users for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy for any client role: admins are promoted
-- by a developer running `insert into admin_users (user_id) values (...)`
-- directly against the Supabase SQL editor.

alter table public.products
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users (id) on delete set null;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);

create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product-images: admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

create policy "product-images: admin update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

create policy "product-images: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );
