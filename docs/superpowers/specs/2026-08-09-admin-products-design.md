# Admin product management — design

Date: 2026-08-09 (updated 2026-08-27: audit fields, client-side image compression)

## Goal

Let a designated "admin" user create, edit, and deactivate ("delete") products from
within the app, without weakening the existing security invariant that the product
catalog is client-read-only (`CLAUDE.md` → Security invariants).

## Non-goals

- Category management (create/edit/delete categories). Admins pick an existing
  category from the current public `categories` list; category CRUD is out of scope.
- Self-service admin signup or an admin role-management UI. Admins are promoted by
  running SQL manually in the Supabase dashboard.
- Hard-deleting product rows. See "Delete semantics" below.

## Admin designation

New table `public.admin_users`:

```sql
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users: select own"
  on public.admin_users for select
  using (auth.uid() = user_id);
```

No insert/update/delete policy exists for any client role. The only way to grant
admin is a developer running `insert into admin_users (user_id) values ('<uuid>');`
against the Supabase dashboard/SQL editor. The app can only ever ask "am I an admin?"
for the logged-in user (`select` against its own row).

### Audit fields on `products`

The same migration adds attribution columns to the existing `products` table:

```sql
alter table public.products
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users (id) on delete set null;
```

`updated_by` references `auth.users`, not `admin_users`, with `on delete set null` —
if an admin is later demoted or their account is removed, product rows don't break
or lose history, they just lose attribution. Both columns are set exclusively by the
`admin-products` Edge Function on every `POST`/`PATCH`/`DELETE`, using the caller id
already established during the admin check — never trusted from the request body,
even if a client sends `updated_by`. The admin list/edit screens display "Última
edición: {editor email} · {date}" using this data; since only admins ever see it,
showing the raw email is sufficient and avoids a separate display-name lookup.

`auth.users` is not a plain public table, so the Edge Function can't resolve emails
with a PostgREST join — it uses the service-role client's Admin API
(`supabase.auth.admin.getUserById`) instead. The `GET` route collects the distinct
`updated_by` ids in the result set and resolves each once (a handful of admins at
most, so no batching concerns), attaching the email as `updated_by_email` on each
product before returning. `POST`/`PATCH`/`DELETE` already know the caller's email
from the initial `auth.getUser()` call, so they attach it to their response directly
without an extra lookup.

## Write path: Edge Function, not client RLS

`products` table RLS is **not modified**. It keeps exactly the policy from the
initial migration: public `select` where `is_active = true`, and no insert/update/
delete policy for anyone. This keeps "catalog is client-read-only" literally true.

All admin product writes — and the admin's *read* of the full catalog (including
inactive rows, which the public policy hides) — go through one new Edge Function:

`supabase/functions/admin-products/index.ts`, deployed with JWT verification on
(no `--no-verify-jwt`), following the `create-order` pattern:
- A user-scoped Supabase client (created from the caller's `Authorization` header)
  identifies the caller via `auth.getUser()`.
- A service-role Supabase client checks `admin_users` for that caller's id; any
  caller not found there gets `403`. Unauthenticated callers get `401`.
- Only after the admin check does the function touch `products`, using the
  service-role client.

Routes (dispatch on `req.method`):

| Method | Body | Behavior |
|---|---|---|
| `GET` | optional `?search=` query param | Returns **all** products (active + inactive), optionally filtered by name, ordered by name, each with an `updated_by_email` field resolved server-side (see below). |
| `POST` | `{ category_id, name, description, price_cents, unit, image_url, stock, is_active }` (zod-validated) | Inserts a new product with `updated_by`/`updated_at` set from the caller, returns it. |
| `PATCH` | `{ id, ...partial fields }` | Updates the product by id, refreshing `updated_by`/`updated_at` from the caller, returns it. |
| `DELETE` | `{ id }` | Soft-deletes: sets `is_active = false`, refreshing `updated_by`/`updated_at`. See below. |

### Delete semantics

`order_items.product_id` references `products(id)` with no `ON DELETE` clause
(defaults to `RESTRICT`), so a real `DELETE` would throw a foreign-key violation
for any product that has ever appeared in an order. To avoid that failure mode
entirely, the Edge Function's `DELETE` route always performs a soft delete
(`is_active = false`) — it never removes the row. The admin UI labels the action
"Eliminar" for familiarity, but it is implemented as deactivation; a deactivated
product can be reactivated by editing it and toggling active back on.

## Image uploads

New Supabase Storage bucket `product-images` (public bucket, so product images
render for all shoppers without auth). `storage.objects` policies:
- Public `select` for this bucket (image display).
- `insert` / `update` / `delete` restricted to callers present in `admin_users`.

The admin app uploads directly to this bucket from the device using the client
Supabase SDK (not through the Edge Function) — this is a storage-layer write, not
a `products` table write, so it doesn't touch the invariant being preserved above.
The resulting public URL is then submitted as the product's `image_url` string.

Device image selection uses `expo-image-picker` — a new dependency not currently
in `package.json`.

Before upload, the picked image is resized and re-encoded with
`expo-image-manipulator` (also new): longest edge capped at 1200px, re-encoded as
JPEG at ~0.8 quality. This keeps storage cost and catalog load times reasonable
without depending on device-native output size. The resize/compress step lives
inside `uploadProductImage` in `models/adminModel.ts`, so controllers and views
just await a public URL as before — the transform is invisible above the model
layer.

## App layer (MVC)

**Models** — `models/adminModel.ts`:
- `checkIsAdmin(userId): Promise<boolean>` — selects the caller's own row from
  `admin_users`.
- `listAllProducts(search?): Promise<Product[]>` — calls `admin-products` (GET).
- `createProduct(input): Promise<Product>` — calls `admin-products` (POST).
- `updateProduct(id, patch): Promise<Product>` — calls `admin-products` (PATCH).
- `deleteProduct(id): Promise<void>` — calls `admin-products` (DELETE).
- `uploadProductImage(uri): Promise<string>` — resizes/compresses via
  `expo-image-manipulator` (max 1200px edge, JPEG ~0.8 quality), then uploads to
  the `product-images` bucket via `supabase.storage`, returns the public URL.

All Edge Function calls go through `supabase.functions.invoke("admin-products", ...)`.

**Controllers** — `controllers/useAdmin.ts`:
- `useIsAdmin()` — TanStack Query wrapping `checkIsAdmin`, keyed by the session
  user id, `enabled` only when a session exists and `DEMO_MODE` is false (demo mode
  has no backend, so admin status is always false there).
- `useAdminProducts(search?)` — query wrapping `listAllProducts`.
- `useCreateProduct` / `useUpdateProduct` / `useDeleteProduct` — mutations that, on
  success, invalidate both `["admin-products"]` and the shopper-facing `["products"]`
  query key (so the catalog screens reflect admin changes immediately).
- `useUploadProductImage` — mutation wrapping `uploadProductImage`.

**Views/routes**:
- `app/(protected)/admin/_layout.tsx` — guards the whole admin section on
  `useIsAdmin()`; redirects non-admins away (mirrors the pattern in
  `app/(protected)/_layout.tsx`).
- `app/(protected)/admin/index.tsx` — product list: search box, all products with
  an active/inactive badge, tap to edit, a "+" action to create.
- `app/(protected)/admin/product/[id].tsx` and `app/(protected)/admin/product/new.tsx`
  — share one form component. Fields: name, description, category (picker sourced
  from the existing `useCategories()`), price (entered in pesos, converted ×100 to
  `price_cents` on submit — reuses the `formatMXN` convention already used for
  display), unit, stock, active toggle, image (pick from device, preview, upload).
  Built with `react-hook-form` + `zod`, matching `app/(protected)/account/profile.tsx`.
  The edit screen shows "Última edición: {editor email} · {date}" (from
  `updated_by`/`updated_at`) and has a destructive "Eliminar" button (confirmation
  alert) that calls `useDeleteProduct`.
- `app/(protected)/(tabs)/account.tsx` — gets a new "Admin" row, rendered only when
  `useIsAdmin()` is true.

## Testing / verification

- `npx tsc --noEmit` and `npx expo lint` after implementation.
- Manual verification in the running app (per project convention, since there is no
  test suite): sign in as a non-admin → confirm no "Admin" row and `/admin` redirects
  away; promote a user via SQL → confirm the row appears, and create/edit/deactivate
  a product, confirming the change is reflected on the shopper-facing catalog screens.
- Confirm a non-admin (or unauthenticated) call to the `admin-products` Edge Function
  is rejected (401/403).
- Confirm `updated_by`/`updated_at` reflect the acting admin after create/edit/delete,
  and that a client-supplied `updated_by` in the request body is ignored (the Edge
  Function always overwrites it with the authenticated caller's id).
- Confirm an uploaded image is resized/re-encoded (check the stored object's
  dimensions and file size) rather than the original device file being uploaded.
