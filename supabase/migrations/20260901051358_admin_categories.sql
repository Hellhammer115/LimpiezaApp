-- Admin category management: audit + soft-delete columns on categories,
-- mirroring the products columns added in 20260827120000_admin_products.
-- The public read policy is tightened to active-only, matching how
-- products already enforces this at the RLS level.

alter table public.categories
  add column is_active  boolean not null default true,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users (id) on delete set null;

drop policy "categories: public read" on public.categories;

create policy "categories: public read active"
  on public.categories for select
  using (is_active = true);
