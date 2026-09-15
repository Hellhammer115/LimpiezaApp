# Cotizaciones (quote-first checkout) — design

Date: 2026-09-14

## Goal

Replace "pay immediately" checkout with a quote-first flow. A customer builds a
cart and confirms it as usual, but confirming now creates a **cotización**
(quote request) instead of charging. Admins receive it (in-app + email), can edit
it (line quantities and unit prices, delivery fee, an order-level discount, a
note), download it as a PDF, and send it. The customer then pays the quoted total
through Mercado Pago. Only once payment is confirmed does the row become a
**pedido**.

The Pedidos tab gains a filter (Cotizaciones | Pedidos) for both roles: customers
see their own rows; admins see everyone's.

## Non-goals

- Push notifications (email only for v1).
- A separate customer "Aceptar cotización" step — paying is accepting.
- Editing a quote after it has been paid.
- Admin role management UI (unchanged: rows inserted into `admin_users` by hand).
- Quotes in demo mode (checkout stays inert there, as today).
- Automated tests (none exist in the repo; see Verification).

## Data model

Cotizaciones **are** rows in the existing `orders` table. A row is a cotización
until it is paid; the distinction is derived, never stored:

```
is_quote  = paid_at IS NULL
is_pedido = paid_at IS NOT NULL
```

So a rejected/cancelled quote stays under Cotizaciones and a cancelled paid order
stays under Pedidos.

### Migration

```sql
-- Enum values must be added in their own statements; nothing else in this
-- migration may reference them (Postgres forbids using a new enum value in the
-- same transaction that created it).
alter type public.order_status add value if not exists 'quote_requested' before 'pending';
alter type public.order_status add value if not exists 'quote_sent'      before 'pending';

alter table public.orders
  add column discount_cents   integer  not null default 0 check (discount_cents >= 0),
  add column discount_percent smallint check (discount_percent between 0 and 100),
  add column admin_note       text,
  add column customer_name    text     not null default '',
  add column customer_phone   text,
  add column customer_email   text     not null default '',
  add column paid_at          timestamptz,
  add column quoted_at        timestamptz,
  add column quoted_by        uuid references auth.users (id) on delete set null,
  add column mp_init_point    text;

-- Original catalog price, kept beside the (admin-editable) unit_price_cents.
alter table public.order_items
  add column catalog_price_cents integer not null default 0;
update public.order_items set catalog_price_cents = unit_price_cents;

-- Admins read everything; still no client write policy on either table.
create policy "orders: admin select all"
  on public.orders for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "order_items: admin select all"
  on public.order_items for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create index orders_paid_at_idx on public.orders (paid_at);
```

Existing rows: `paid_at` is backfilled from `updated_at` for rows whose status is
`paid`/`preparing`/`delivering`/`delivered` so they land under Pedidos.

### Money rule (single formula, applied everywhere)

```
subtotal_cents      = Σ order_items.unit_price_cents × quantity
discount_cents      = percent set ? round(subtotal × percent / 100) : entered amount
delivery_fee_cents  = admin override, default from the free-delivery rule at request time
total_cents         = subtotal − discount + delivery_fee      (never < 0)
```

### Atomic quote edit RPC

`public.apply_quote_edit(p_order_id uuid, p_items jsonb, p_delivery_fee_cents int,
p_discount_cents int, p_discount_percent smallint, p_admin_note text)` —
`security definer`, `execute` revoked from `public` and granted only to
`service_role` (same pattern as `20260911231900_revoke_public_execute.sql`).

- `p_items` = `[{ id, quantity, unit_price_cents }]`; items absent from the array
  are deleted; at least one item must remain.
- Only applies when `status in ('quote_requested','quote_sent')`; raises otherwise.
- Recomputes `subtotal_cents`, `discount_cents` (from percent when given),
  `total_cents`; clears `mp_preference_id`/`mp_init_point`; bumps `updated_at`.
- Returns the updated order row.

## Status machine

```
quote_requested ──admin send────────▶ quote_sent ──customer Pagar──▶ pending ──webhook approved──▶ paid ▶ preparing ▶ delivering ▶ delivered
quote_requested | quote_sent ──admin reject | customer cancel──▶ cancelled
pending ──webhook rejected/cancelled──▶ quote_sent        (quote survives; preference cleared; customer may retry)
```

- Admin edits are allowed in `quote_requested` and `quote_sent`; "send" from
  `quote_sent` re-sends (re-emails) the customer.
- Any edit clears the stored MP preference so a stale amount is never charged.
- Stock is checked at request time and at pay time; decremented only on `paid`
  (existing `decrement_stock_for_order`, unchanged).
- `paid_at` is set by the webhook together with `status = 'paid'`.

## Edge Functions (Deno, `supabase/functions/`)

### `_shared/`

- `auth.ts` — `getCaller(req)` (user-scoped client + user) and `requireAdmin(...)`
  (copied from `admin-products`' check).
- `http.ts` — `json(body, status)`.
- `delivery.ts` — `FREE_DELIVERY_THRESHOLD_CENTS`, `DELIVERY_FEE_CENTS`,
  `deliveryFeeCents(subtotal)`. Authoritative; `models/delivery.ts` stays as the
  display mirror (CLAUDE.md note updated to point here).
- `email.ts` — `sendEmail({ to, subject, html })` via Resend's REST API using
  `RESEND_API_KEY` and `QUOTES_FROM_EMAIL`. If either secret is missing it logs a
  warning and returns without throwing. Callers never let an email failure fail
  the request.
- `adminEmails.ts` — resolves `admin_users` → emails via
  `auth.admin.getUserById` (same approach admin-products uses for editors).

### `create-quote` (replaces `create-order`, which is deleted)

`verify_jwt = true`. Body identical to today (`addressId`, `deliverySlot`,
`items[{productId, quantity}]`). Steps: validate → load address (RLS) and
products (service role) → reject inactive / insufficient stock → snapshot items
with `unit_price_cents = catalog_price_cents = price_cents` → snapshot customer
from `profiles` (service role) → insert order with `status = 'quote_requested'`,
`discount_cents = 0`, computed delivery fee and total → insert items (delete the
order on failure, as today) → email admins "Nueva cotización #xxxxxxxx" (best
effort) → return `{ orderId }`.

### `quote-actions` (customer)

`verify_jwt = true`. Body `{ action: "pay" | "cancel", orderId }`. The order is
loaded through the user-scoped client so RLS enforces ownership.

- `pay`: status must be `quote_sent` or `pending`. If `pending` with a stored
  `mp_init_point`, return it (customer abandoned the browser). Otherwise re-check
  every item's product is active with enough stock (409 with the product name
  otherwise), create an MP preference with **one line item**
  `"Cotización #xxxxxxxx"` at `total_cents / 100` MXN (MP rejects negative
  discount lines; itemization lives in the app and PDF), `external_reference =
  orderId`, `X-Idempotency-Key = orderId`, same notification/back URLs as today;
  store `mp_preference_id` + `mp_init_point`, set `status = 'pending'`; return
  `{ initPoint }`.
- `cancel`: status must be `quote_requested` or `quote_sent` → `cancelled`.

### `admin-orders` (admin)

`verify_jwt = true`; every request runs `requireAdmin`.

- `GET ?kind=quotes|orders` → `OrderWithItems[]` newest first, filtered by
  `paid_at is null` / `is not null`. Optional `?search=` matches
  `customer_name`/`customer_email`/short id.
- `PATCH { id, items, delivery_fee_cents, discount: { type: "amount", cents } |
  { type: "percent", value }, admin_note }` → validates (quantities 1–99, prices
  ≥ 0, discount ≤ subtotal, fee ≥ 0, ≥ 1 item), calls `apply_quote_edit`, returns
  the order with items.
- `POST { id, action }`:
  - `send` — from `quote_requested`/`quote_sent` → `quote_sent`, sets
    `quoted_at`/`quoted_by`; emails the customer "Tu cotización está lista"
    (best effort).
  - `reject` (`note?`) — from the two quote states → `cancelled`, `admin_note = note`.
  - `advance` (`to`) — only the next step in `paid → preparing → delivering →
    delivered`; guarded by the current status in the `update ... eq(status)`.

### `mp-webhook` (changes only)

- approved: `status = 'paid'`, `paid_at = now()`, `mp_payment_id`, then stock
  decrement (as today).
- rejected/cancelled: `status = 'quote_sent'`, `mp_payment_id` recorded,
  `mp_preference_id`/`mp_init_point` cleared. (Previously → `cancelled`.)

Secrets to add: `RESEND_API_KEY`, `QUOTES_FROM_EMAIL` (documented in
`.env.example`'s secrets section and CLAUDE.md).

## App: models

- `models/types.ts` — `OrderStatus` gains `quote_requested` | `quote_sent`;
  `Order` gains the new columns; `OrderItem` gains `catalog_price_cents`;
  `QuoteEditInput` and `DiscountInput` types.
- `models/orderStatus.ts` — labels: `quote_requested` "Nueva cotización",
  `quote_sent` "Cotización enviada" (existing ones unchanged); styles for both;
  predicates `isQuote(order)`, `canPay(status)`, `canCancelQuote(status)`,
  `isQuoteEditable(status)`, `nextFulfillmentStatus(status)`, and a pure
  `computeTotals({ items, discount, deliveryFee })` used by the editor's live
  totals (mirrors the SQL formula).
- `models/quoteModel.ts` — `requestQuote(request)` (invokes `create-quote`),
  `cancelQuote(orderId)`.
- `models/paymentModel.ts` — `payQuote(orderId)` (invokes `quote-actions`),
  `openMercadoPagoCheckout` (unchanged). `createOrder` removed.
- `models/adminOrderModel.ts` — `listAdminOrders(kind, search?)`,
  `updateQuote(id, input)`, `sendQuote(id)`, `rejectQuote(id, note?)`,
  `advanceOrder(id, to)`. Reuses `invokeAdminFunction` from `adminModel.ts`
  (exported, union widened to include `"admin-orders"`).
- `models/quoteDocument.ts` — `buildQuoteHtml(order: OrderWithItems): string`.
  Pure. Contents: business header, "Cotización #xxxxxxxx", date, customer
  (name/phone/email), delivery address and slot, items table (qty, name, unit
  price, line total), subtotal, discount (with % when set), envío, total, admin
  note. Uses inline CSS only (expo-print renders in a WebView).
- Function invocation errors: a shared `functionErrorMessage(error)` helper in
  `models/functionError.ts` reads `error.context` (FunctionsHttpError) to surface
  the server's Spanish `error` string, falling back to the current generic text.
  Used by the quote/payment/admin-order models.

## App: controllers

- `useCheckout` — `requestQuote(addressId, slot)`; on success clears the cart and
  `router.replace('/checkout/result?order_id=…')`.
- `useQuote.ts` — `usePayQuote()` (mutation: `payQuote` → open browser →
  `router.replace` to result), `useCancelQuote()`; both invalidate `['orders']`.
- `useOrders.ts` — `useOrders(kind)` filters client-side on `paid_at` (single
  fetch of the user's rows); `useOrder` polls every 5s only while status is
  `pending`/fulfillment-in-progress, 15s in quote states, stops on final.
  `useOrderPaymentStatus` unchanged (polls only while `pending`).
- `useAdminOrders.ts` — `useAdminOrders(kind, search?)`, `useUpdateQuote`,
  `useQuoteAction` (send/reject/advance); all invalidate `['admin-orders']` and
  `['orders']`. The admin detail screen reuses `useOrder(id)`: the new RLS policy
  lets admins read any order directly, so no separate admin fetch is needed.
- `useQuotePdf.ts` — `downloadQuotePdf(order)`: native →
  `Print.printToFileAsync({ html })` then `Sharing.shareAsync(uri, { mimeType:
  'application/pdf', UTI: 'com.adobe.pdf' })`; web → `Print.printAsync({ html })`
  (browser print dialog with "save as PDF"). Errors → `Alert`.

New dependencies (installed with `npx expo install`): `expo-print`, `expo-sharing`.

## App: screens and views

- **`app/(protected)/checkout/index.tsx`** — button "Solicitar cotización"; footer
  copy: "Un asesor confirmará precios y disponibilidad; te avisaremos cuando tu
  cotización esté lista." Delivery-fee line labelled "Envío (estimado)".
- **`app/(protected)/checkout/result.tsx`** — keyed on `order.status`:
  - `quote_requested` → "¡Cotización enviada!" + "Ver cotización" / "Seguir comprando".
  - `pending` → existing "Confirmando tu pago…".
  - `quote_sent` → "El pago no se completó" + "Ver cotización" (retry from detail).
  - `paid`+ → existing success screen.
  - `cancelled` → "Cotización cancelada" + home.
- **`app/(protected)/(tabs)/orders.tsx`** — title "Pedidos"; segmented filter
  chips Cotizaciones | Pedidos (default Cotizaciones; remembered in component
  state only). Data source: `useIsAdmin()` → admin ? `useAdminOrders(kind)` :
  `useOrders(kind)`. Rows rendered by `views/OrderCard.tsx` (status badge, date,
  slot, total; admins also see `customer_name`, and `quote_requested` rows get a
  "Nueva" accent). Tap → admin: `/admin/order/[id]`, customer: `/order/[id]`.
  Empty states differ per filter.
- **`app/(protected)/order/[id].tsx`** (customer) — header "Cotización #" or
  "Pedido #" by `isQuote`; admin note card when present; totals via
  `views/OrderTotals.tsx` (adds the discount line); sticky footer: "Pagar
  {total} con Mercado Pago" when `canPay`, "Cancelar cotización" (confirm
  Alert) when `canCancelQuote`.
- **`app/(protected)/admin/order/[id].tsx`** (admin) — customer card
  (name/phone/email), address + slot, then:
  - quote states: `views/QuoteEditor.tsx` (controlled; per line: name, catalog
    price hint, unit-price input, `QuantityStepper`, remove; delivery-fee input;
    discount input with $/% toggle; note input; live totals from
    `computeTotals`). Footer: "Guardar cambios" (enabled when dirty), "Enviar
    cotización" (saves first if dirty), "Rechazar" (prompt for note), and a
    "Descargar PDF" header action.
  - pedido states: read-only items + `OrderTotals`, "Avanzar a {next label}"
    when `nextFulfillmentStatus` exists, PDF action.
- **`views/OrderTotals.tsx`** — subtotal / descuento (hidden when 0) / envío /
  total; used by customer detail, admin detail (read-only mode) and checkout.
- **`utils/format.ts`** — add `parseMXNInput(text): number | null` (cents from a
  "123.45"-style string) for the editor inputs.
- `tailwind.config.js` content globs already cover `app/` and `views/`; no change.

## Error handling

- Edge Functions return 4xx with a Spanish `error` message for every user-facing
  rule (ownership, status transition, stock, validation) and 5xx only for
  unexpected failures. Status guards are enforced in the `update` predicate
  (`.eq('status', …)` / `.in(...)`), so concurrent actions cannot double-apply.
- Email failures are logged, never surfaced to the caller and never roll back.
- Client mutations show the server message in an `Alert` and re-fetch the order
  so the UI reflects whatever actually happened.
- PDF generation failure (no share target, permission) shows an `Alert`.

## Verification

No test runner exists. Definition of done:

1. `npx tsc --noEmit` and `npx expo lint` clean (after `npx expo start` once for
   typed routes).
2. `npx supabase db push`; deploy `create-quote`, `quote-actions`,
   `admin-orders`, `mp-webhook --no-verify-jwt`; set the two new secrets.
3. Manual end-to-end with MP sandbox: request quote → cart cleared, result screen,
   admin email received → admin sees it under Cotizaciones with "Nueva" → edit
   price/qty/discount/fee, save, PDF share sheet opens with correct totals → send
   → customer email received, "Pagar" visible → pay → webhook → row appears under
   Pedidos for both roles, stock decremented → admin advances to Entregado.
4. Negative paths: failed sandbox payment returns the row to Cotización enviada;
   customer cancel; admin reject with note visible to customer; edit attempt on a
   paid order rejected by the RPC.

## Documentation updates

- CLAUDE.md: commands (new function names, secrets), architecture (new
  models/controllers), security invariants (quotes are orders; admin can edit
  only unpaid rows via `apply_quote_edit`; `paid_at`/status still only from the
  webhook), gotcha about enum values in migrations.
- `.env.example`: the two new secrets.
