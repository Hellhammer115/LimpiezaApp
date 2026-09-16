-- Admin-created cotizaciones: who sent it. While address_id is null on such a
-- row, delivery_address/delivery_slot are '' and the customer must accept
-- (choose address + slot) before paying.
alter table public.orders
  add column created_by_admin uuid references auth.users (id) on delete set null;