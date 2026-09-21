# Admin-created cotizaciones — design

Date: 2026-09-16. Builds on `2026-09-14-cotizaciones-design.md`.

## Goal

Let an admin build a cotización for a specific registered customer from the
normal catalog/cart, adjust prices, quantities, delivery fee, discount and note
before sending, and send it. The customer receives it like any other quote,
then either **accepts** it (choosing delivery address and time slot, then
paying) or **rejects** it.

## Non-goals

- Quoting people without an account (no email-link acceptance).
- Admins choosing the customer's address or slot (they never see addresses).
- Changing the recipient after sending (reject + create a new one instead).
- A separate "offers" table — admin-created quotes are ordinary `orders` rows.

## Data model

One migration:

```sql
alter table public.orders
  add column created_by_admin uuid references auth.users (id) on delete set null;
```

Semantics:

- `created_by_admin IS NOT NULL` ⇒ the quote was sent by an admin.
- `address_id IS NULL` on such a row ⇒ **needs acceptance**: `delivery_address`
  and `delivery_slot` hold `''` until the customer accepts.
- Everything else (status machine, `paid_at`, hide flags, PDF, editor) is
  unchanged; the row is a normal `quote_sent` quote from the moment it is created.

Derived predicate (client + server): `needsAcceptance(order) =
order.created_by_admin != null && order.address_id == null`.

## Edge Functions

### `admin-users` (new, admin-gated, `verify_jwt = true`)

`GET ?q=<text>` → up to 10 rows `{ user_id, name, last_name, email, phone }`
from `profiles` where `email ilike %q%` or `phone ilike %q%` (service role;
`q` trimmed, min 3 chars, `%`/`,`/`(`/`)` stripped before use). Never returns
addresses.

### `admin-orders` — new `POST { action: "create" }`

Body:

```
{ action: "create", userId, items: [{ productId, quantity, unit_price_cents }],
  delivery_fee_cents, discount: { type: "amount", cents } | { type: "percent", value },
  admin_note: string | null }
```

Steps: `requireAdmin` → validate (zod: 1–50 items, quantities 1–99, prices ≥ 0,
fee ≥ 0; `unit_price_cents` is the admin's chosen price) → load products
(service role; every product must exist and be active; stock must cover the
quantity, 409 "Sin existencias: <name>" otherwise) → load the recipient's
`profiles` row (404 "Cliente no encontrado") → insert the order with
`status = 'quote_sent'`, `user_id = recipient`, `created_by_admin = caller`,
`quoted_at/quoted_by`, `address_id = null`, `delivery_address = ''`,
`delivery_slot = ''`, customer snapshot, catalog prices and the rule-based
delivery fee → insert items with `catalog_price_cents = price_cents` →
call `apply_quote_edit(order.id, <items with the admin's unit prices>,
delivery_fee_cents, discount…, admin_note)` so totals are computed by the
single authoritative formula (on RPC failure delete the order and return 409
with its message) → email the customer "Recibiste una cotización de
LimpiezaApp" (best effort) → return the order with items.

### `quote-actions` — new `{ action: "accept", orderId, addressId, deliverySlot }`

The order is read through the RLS client (ownership). Allowed only when
`status = 'quote_sent'`, `created_by_admin` is set and `address_id` is null;
otherwise 409 "Esta cotización no requiere aceptación". The address is read
through the RLS client (400 "Dirección no encontrada"). Update guarded in the
predicate: set `address_id`, `delivery_address` snapshot (same format as
`create-quote`), `delivery_slot`, `updated_at`. Returns `{ ok: true }`.

`pay`: additionally refuses when `address_id` is null with 409
"Elige una dirección y horario antes de pagar".

Reject = existing `cancel` (already allowed from `quote_sent`).

## App: models and controllers

- `models/types.ts`: `Order.created_by_admin: string | null`;
  `AdminCreateQuoteInput`; `CustomerMatch = { user_id, name, last_name, email, phone }`.
- `models/orderStatus.ts`: `needsAcceptance(order)`, label helper
  `isAdminQuote(order)`.
- `models/adminOrderModel.ts`: `lookupCustomers(q)`, `createQuoteForCustomer(input)`.
  `invokeAdminFunction` union gains `"admin-users"`.
- `models/quoteModel.ts`: `acceptQuote(orderId, addressId, deliverySlot)`.
- `controllers/useAdminOrders.ts`: `useCustomerLookup(q)` (debounced by the
  screen, enabled when `q.length >= 3`), `useCreateQuoteForCustomer()` (clears the
  cart, invalidates, navigates to `/admin/order/[id]`).
- `controllers/useQuote.ts`: `useAcceptQuote()` (on success invalidates and
  triggers `usePayQuote`'s flow via a callback from the screen).
- `views/QuoteEditor.tsx`: unchanged; the admin screen builds a `QuoteDraft`
  from the cart using `productId` as the line `id`, `catalog_price_cents =
  priceCents`, then maps `draft.items` to `{ productId, quantity, unit_price_cents }`.

## Screens

- **Cart** (`app/(protected)/cart.tsx`): for admins (`useIsAdmin`), a second
  button "Cotizar a un cliente" under the normal checkout button, routing to
  `/admin/quote/new`. Customers see no change.
- **`app/(protected)/admin/quote/new.tsx`** (admin group, guarded by the admin
  layout): search input "Correo o teléfono del cliente" → result rows (name,
  email, phone) → selected customer card with "Cambiar"; below it the
  `QuoteEditor` seeded from the cart; sticky footer "Enviar cotización" enabled
  when a customer is selected and the draft has ≥ 1 item. On success: cart
  cleared, `router.replace('/admin/order/<id>')`. Empty cart → EmptyState
  "Agrega productos al carrito primero".
- **Customer detail** (`app/(protected)/order/[id].tsx`): when
  `isAdminQuote`, a line "Cotización enviada por LimpiezaApp"; address/slot
  show "Por definir" while empty. Footer while `needsAcceptance`: "Aceptar
  cotización" (→ `/order/<id>/accept`) and "Rechazar cotización" (confirm →
  cancel). Once accepted, the normal Pagar/Cancelar footer.
- **`app/(protected)/order/[id]/accept.tsx`**: address list with radio +
  "Agregar dirección", slot chips (both as in checkout), totals, footer
  "Aceptar y pagar": runs accept, then the pay mutation. If pay fails (e.g.
  payments not configured) the alert shows and the user lands back on the
  detail, which now shows Pagar.
- **Admin detail / PDF / OrderCard**: address and slot render "Por definir"
  when empty; card subtitle shows the customer as today. Nothing else changes.
- **Result screen**: unchanged (pay path is the same).

## Error handling

Spanish 4xx messages surfaced through `functionErrorMessage`. Acceptance and
creation are guarded in update predicates / RPC, so double taps cannot
double-apply. Email failures never fail the request.

## Verification

tsc, lint. On device: admin builds a cart → "Cotizar a un cliente" → search by
phone → select → edit a price and a discount → Enviar → lands on admin detail
with "Por definir"; customer sees the email and the quote with Aceptar/Rechazar;
Aceptar → picks address + slot → "Aceptar y pagar" → 503 alert (MP unset) →
detail now shows the address and Pagar; Rechazar on another → Cancelado; admin
can edit and re-send an unaccepted quote; `pay` on an unaccepted quote via curl
→ 409.
