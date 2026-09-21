-- Per-role "delete" of a cancelled cotización: each side hides the row from
-- its own list; the row is physically removed only once both have hidden it.
alter table public.orders
  add column hidden_by_customer_at timestamptz,
  add column hidden_by_admin_at    timestamptz;
