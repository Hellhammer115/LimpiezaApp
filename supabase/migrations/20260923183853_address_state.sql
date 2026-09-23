-- Adds the Mexican state ("Estado") to delivery addresses, alongside city/zip.
alter table public.addresses
  add column state text not null default '';
