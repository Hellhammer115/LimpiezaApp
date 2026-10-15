-- Optional photo per category (admin-uploaded). When set, the shopper's
-- category tile shows it instead of the icon; the icon stays required as the
-- fallback. Images reuse the public-read / admin-write product-images bucket
-- (20260827120000_admin_products.sql), under a categories/ prefix.
alter table public.categories
  add column image_url text;
