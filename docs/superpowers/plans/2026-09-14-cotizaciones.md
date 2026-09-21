# Cotizaciones (Quote-First Checkout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirming a cart creates a *cotización* (a `quote_requested` order) that admins receive, edit, PDF-export and send; the customer then pays the quoted total via Mercado Pago, and only a paid row is a *pedido*.

**Architecture:** Cotizaciones are rows of the existing `orders` table (`paid_at IS NULL` ⇒ cotización). Two new statuses (`quote_requested`, `quote_sent`) precede the existing `pending → paid → …` chain. Three Edge Functions own every write: `create-quote` (customer request), `quote-actions` (customer pay/cancel) and `admin-orders` (admin list/edit/send/reject/advance; edits go through an atomic SQL RPC). The app gets role-aware Pedidos tab with a Cotizaciones | Pedidos filter, a customer detail with Pagar/Cancelar, and an admin detail with an editor + PDF export (expo-print + expo-sharing).

**Tech Stack:** Expo SDK 57 + React Native + expo-router + NativeWind, Supabase (Postgres/Auth/Edge Functions in Deno), TanStack Query v5, zustand, zod, `expo-print` + `expo-sharing` (new), Resend REST API (email, server side only).

**Spec:** `docs/superpowers/specs/2026-09-14-cotizaciones-design.md`

## Global Constraints

- `orders` / `order_items` keep **zero** client write policies; every write goes through an Edge Function with the service role. The only new RLS is admin `select`. (Spec → Data model)
- Payment truth still comes only from `mp-webhook`; `paid` and `paid_at` are set nowhere else. The result screen only polls. (CLAUDE.md → Security invariants)
- Money is integer cents everywhere. Formula everywhere: `total = subtotal(items) − discount + delivery_fee`, clamped at 0. (Spec → Money rule)
- Admin edits are allowed only while `status in ('quote_requested','quote_sent')` and always clear `mp_preference_id`/`mp_init_point`. (Spec → Status machine)
- New enum values are added in their own statements and never referenced in the same migration (Postgres restriction). (Spec → Migration)
- Email is best effort: a failure is logged and never fails the request. Secrets `RESEND_API_KEY`, `QUOTES_FROM_EMAIL` live only in `supabase secrets`. (Spec → Edge Functions)
- Views never import `@/services/supabase` or `@/models/*` data-access functions directly: view → controller → model. (CLAUDE.md → Architecture)
- Spanish UI copy; all Edge Function `error` strings are Spanish and user-displayable.
- `supabase/functions/**` is Deno (`Deno.serve`, `npm:` imports, `../_shared/x.ts` relative imports). Never convert to Node style.
- No automated test suite exists; verification per task is `npx tsc --noEmit`, `npx expo lint`, and the manual steps written into each task. Typed routes regenerate only while `npx expo start` runs; run it once after adding routes before trusting `tsc`.
- Windows: source files are UTF-8 without BOM; never bulk-edit with PowerShell `Get-Content`/`Set-Content`.
- Commit after every task with the attribution trailer already configured for this session.

---

### Task 1: Migration — quote statuses, columns, admin read policies, `apply_quote_edit`

**Files:**
- Create: `supabase/migrations/20260914120000_quotes_enum.sql`
- Create: `supabase/migrations/20260914120100_quotes.sql`

**Interfaces:**
- Produces: enum values `quote_requested`, `quote_sent`; `orders` columns `discount_cents`, `discount_percent`, `admin_note`, `customer_name`, `customer_phone`, `customer_email`, `paid_at`, `quoted_at`, `quoted_by`, `mp_init_point`; `order_items.catalog_price_cents`; policies `orders: admin select all`, `order_items: admin select all`; function `public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text) returns public.orders` (service_role only).
- Consumes: `public.admin_users`, `public.orders`, `public.order_items` from earlier migrations.

- [ ] **Step 1: Write the enum migration (its own file so nothing else references the new values in the same transaction)**

```sql
-- Quote-first checkout, part 1/2: new order statuses.
-- Kept in its own migration: Postgres refuses to USE a new enum value inside
-- the transaction that added it, and the CLI wraps each file in one.
alter type public.order_status add value if not exists 'quote_requested' before 'pending';
alter type public.order_status add value if not exists 'quote_sent'      before 'pending';
```

- [ ] **Step 2: Write the main migration**

```sql
-- Quote-first checkout, part 2/2: quote columns, admin read access, and the
-- atomic edit RPC. A cotización IS an orders row; "pedido" simply means
-- paid_at is not null. No client write policy is added — every write still
-- goes through Edge Functions with the service role.

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

-- Rows paid before this migration are pedidos: give them a paid_at.
update public.orders
set paid_at = updated_at
where paid_at is null
  and status in ('paid', 'preparing', 'delivering', 'delivered');

create index orders_paid_at_idx on public.orders (paid_at);

-- Original catalog price, kept beside the admin-editable unit_price_cents.
alter table public.order_items
  add column catalog_price_cents integer not null default 0
    check (catalog_price_cents >= 0);
update public.order_items set catalog_price_cents = unit_price_cents;

-- Admins read every order; the existing "select own" policies stay for customers.
create policy "orders: admin select all"
  on public.orders for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "order_items: admin select all"
  on public.order_items for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- apply_quote_edit: replaces the line items of an UNPAID quote and recomputes
-- every total in one transaction. Items missing from p_items are deleted.
-- p_items: [{ "id": uuid, "quantity": int, "unit_price_cents": int }, ...]
-- Called only by the admin-orders Edge Function (service role).
-- ---------------------------------------------------------------------------
create or replace function public.apply_quote_edit(
  p_order_id         uuid,
  p_items            jsonb,
  p_delivery_fee_cents integer,
  p_discount_cents   integer,
  p_discount_percent smallint,
  p_admin_note       text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_subtotal integer;
  v_discount integer;
  v_count    integer;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if v_order.status not in ('quote_requested', 'quote_sent') then
    raise exception 'La cotización ya no se puede editar' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización debe tener al menos un producto' using errcode = 'P0001';
  end if;
  if p_delivery_fee_cents < 0 or p_discount_cents < 0 then
    raise exception 'Montos inválidos' using errcode = 'P0001';
  end if;

  -- Every submitted id must belong to this order.
  select count(*) into v_count
  from jsonb_array_elements(p_items) e
  join public.order_items oi on oi.id = (e->>'id')::uuid and oi.order_id = p_order_id;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'Producto inválido en la cotización' using errcode = 'P0001';
  end if;

  update public.order_items oi
  set quantity         = (e->>'quantity')::integer,
      unit_price_cents = (e->>'unit_price_cents')::integer
  from jsonb_array_elements(p_items) e
  where oi.id = (e->>'id')::uuid and oi.order_id = p_order_id;

  delete from public.order_items oi
  where oi.order_id = p_order_id
    and oi.id not in (select (e->>'id')::uuid from jsonb_array_elements(p_items) e);

  select coalesce(sum(quantity * unit_price_cents), 0) into v_subtotal
  from public.order_items where order_id = p_order_id;

  if p_discount_percent is not null then
    v_discount := round(v_subtotal * p_discount_percent / 100.0);
  else
    v_discount := p_discount_cents;
  end if;
  if v_discount > v_subtotal then
    raise exception 'El descuento no puede superar el subtotal' using errcode = 'P0001';
  end if;

  update public.orders
  set subtotal_cents     = v_subtotal,
      discount_cents     = v_discount,
      discount_percent   = p_discount_percent,
      delivery_fee_cents = p_delivery_fee_cents,
      total_cents        = greatest(v_subtotal - v_discount + p_delivery_fee_cents, 0),
      admin_note         = nullif(btrim(coalesce(p_admin_note, '')), ''),
      mp_preference_id   = null,
      mp_init_point      = null,
      updated_at         = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

-- Same hardening as 20260911231900_revoke_public_execute.sql.
revoke execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  from public, anon, authenticated;
grant execute on function public.apply_quote_edit(uuid, jsonb, integer, integer, smallint, text)
  to service_role;
```

- [ ] **Step 3: Apply and verify**

Run: `npx supabase db push`
Expected: both migrations applied without error.

Then in the Supabase SQL editor:

```sql
select enum_range(null::public.order_status);
-- expect {quote_requested,quote_sent,pending,paid,preparing,delivering,delivered,cancelled}
select proacl from pg_proc where proname = 'apply_quote_edit';
-- expect an ACL containing service_role=X and no "=X/" (PUBLIC) entry
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260914120000_quotes_enum.sql supabase/migrations/20260914120100_quotes.sql
git commit -m "Add quote statuses, quote columns, admin read policies and apply_quote_edit RPC"
```

---

### Task 2: Edge Function shared helpers (`_shared/`)

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/delivery.ts`
- Create: `supabase/functions/_shared/email.ts`
- Create: `supabase/functions/_shared/adminEmails.ts`

**Interfaces:**
- Produces:
  - `json(body: unknown, status?: number): Response`
  - `getCaller(req): Promise<{ userClient, admin, user } | Response>` — returns a 401 `Response` when unauthenticated. `userClient` is RLS-scoped; `admin` is the service-role client.
  - `requireAdmin(admin, userId): Promise<boolean>`
  - `FREE_DELIVERY_THRESHOLD_CENTS`, `DELIVERY_FEE_CENTS`, `deliveryFeeCents(subtotal: number): number`
  - `sendEmail(input: { to: string[]; subject: string; html: string }): Promise<void>` — never throws.
  - `listAdminEmails(admin): Promise<string[]>`
- Consumes: Task 1's `admin_users`.

- [ ] **Step 1: `http.ts`**

```ts
// Shared JSON response helper for Edge Functions.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: `auth.ts`**

```ts
// Shared caller identification for Edge Functions deployed with verify_jwt = true.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { json } from "./http.ts";

export interface Caller {
  /** RLS-scoped client acting as the signed-in user. */
  userClient: SupabaseClient;
  /** Service-role client (bypasses RLS). Use only after authorization checks. */
  admin: SupabaseClient;
  user: { id: string; email?: string };
}

/** Resolves the signed-in user, or returns a ready 401 response. */
export async function getCaller(req: Request): Promise<Caller | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return json({ error: "No autorizado" }, 401);

  return {
    userClient,
    admin: createClient(supabaseUrl, serviceKey),
    user: { id: data.user.id, email: data.user.email ?? undefined },
  };
}

/** True when the user has a row in admin_users. */
export async function requireAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
```

- [ ] **Step 3: `delivery.ts`**

```ts
// Authoritative delivery fee rule. models/delivery.ts in the app is a
// display-only mirror — change both together.
export const FREE_DELIVERY_THRESHOLD_CENTS = 35000;
export const DELIVERY_FEE_CENTS = 3900;

export function deliveryFeeCents(subtotalCents: number): number {
  return subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS ? 0 : DELIVERY_FEE_CENTS;
}
```

- [ ] **Step 4: `email.ts`**

```ts
// Best-effort transactional email through Resend's REST API.
// Never throws: a missing secret or a failed request is logged and ignored,
// because an email problem must never fail the business operation.
export interface EmailInput {
  to: string[];
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailInput): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("QUOTES_FROM_EMAIL");
  if (!apiKey || !from) {
    console.warn("Email skipped: RESEND_API_KEY / QUOTES_FROM_EMAIL not configured");
    return;
  }
  if (to.length === 0) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) console.error("Email failed", res.status, await res.text());
  } catch (error) {
    console.error("Email failed", error);
  }
}

/** Minimal HTML escaping for values interpolated into email bodies. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

- [ ] **Step 5: `adminEmails.ts`**

```ts
// Resolves every admin's email. auth.users is not PostgREST-joinable, so
// each id goes through the Admin API (same approach as admin-products).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function listAdminEmails(admin: SupabaseClient): Promise<string[]> {
  const { data: rows, error } = await admin.from("admin_users").select("user_id");
  if (error || !rows) return [];
  const emails: string[] = [];
  for (const row of rows) {
    const { data } = await admin.auth.admin.getUserById(row.user_id as string);
    if (data.user?.email) emails.push(data.user.email);
  }
  return emails;
}
```

- [ ] **Step 6: Verify Deno type-checks the folder**

Run: `npx supabase functions serve --no-verify-jwt` for ~10 seconds (Ctrl+C) or, if Deno is installed, `deno check supabase/functions/_shared/*.ts`.
Expected: no type errors reported for `_shared`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared
git commit -m "Add shared Edge Function helpers: auth, json, delivery rule, email"
```

---

### Task 3: `create-quote` Edge Function (replaces `create-order`)

**Files:**
- Create: `supabase/functions/create-quote/index.ts`
- Delete: `supabase/functions/create-order/index.ts`
- Modify: `supabase/config.toml` (rename the `[functions.create-order]` block)

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `POST create-quote` body `{ addressId: uuid, deliverySlot: string, items: [{ productId: uuid, quantity: 1..99 }] }` → `200 { orderId: string }`; errors `400 { error }`, `401`, `409 { error }` ("Un producto ya no está disponible" / "Sin existencias: <name>"), `500`.

- [ ] **Step 1: Write the function**

```ts
// create-quote: turns the caller's cart into a cotización (orders row with
// status quote_requested). Every price is recomputed from the database —
// client-sent amounts are never trusted. No payment happens here: the
// customer pays later through quote-actions once an admin sends the quote.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { listAdminEmails } from "../_shared/adminEmails.ts";
import { getCaller } from "../_shared/auth.ts";
import { deliveryFeeCents } from "../_shared/delivery.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";

const quoteSchema = z.object({
  addressId: z.string().uuid(),
  deliverySlot: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { userClient, admin, user } = caller;

    const parsed = quoteSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
    const { addressId, deliverySlot, items } = parsed.data;

    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      return json({ error: "Solicitud inválida" }, 400);
    }

    const [addressResult, productsResult, profileResult] = await Promise.all([
      // Address ownership is enforced by RLS through the user client.
      userClient
        .from("addresses")
        .select("label, street, colonia, city, zip")
        .eq("id", addressId)
        .maybeSingle(),
      admin
        .from("products")
        .select("id, name, price_cents, stock, is_active")
        .in("id", productIds),
      admin
        .from("profiles")
        .select("name, last_name, phone, email")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const address = addressResult.data;
    if (!address) return json({ error: "Dirección no encontrada" }, 400);
    if (productsResult.error) throw productsResult.error;
    const products = productsResult.data;
    const profile = profileResult.data;

    const deliveryAddress = [
      `${address.label}: ${address.street}`,
      address.colonia,
      `${address.city} ${address.zip}`.trim(),
    ]
      .filter(Boolean)
      .join(", ");

    let subtotalCents = 0;
    const orderItems: {
      product_id: string;
      name: string;
      quantity: number;
      unit_price_cents: number;
      catalog_price_cents: number;
    }[] = [];

    for (const item of items) {
      const product = products?.find((p) => p.id === item.productId);
      if (!product || !product.is_active) {
        return json({ error: "Un producto ya no está disponible" }, 409);
      }
      if (product.stock < item.quantity) {
        return json({ error: `Sin existencias: ${product.name}` }, 409);
      }
      subtotalCents += product.price_cents * item.quantity;
      orderItems.push({
        product_id: product.id,
        name: product.name,
        quantity: item.quantity,
        unit_price_cents: product.price_cents,
        catalog_price_cents: product.price_cents,
      });
    }

    const feeCents = deliveryFeeCents(subtotalCents);
    const customerName = [profile?.name, profile?.last_name].filter(Boolean).join(" ").trim();

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        user_id: user.id,
        address_id: addressId,
        delivery_address: deliveryAddress,
        status: "quote_requested",
        subtotal_cents: subtotalCents,
        discount_cents: 0,
        delivery_fee_cents: feeCents,
        total_cents: subtotalCents + feeCents,
        delivery_slot: deliverySlot,
        customer_name: customerName,
        customer_phone: profile?.phone ?? null,
        customer_email: profile?.email ?? user.email ?? "",
      })
      .select("id")
      .single();
    if (orderError) throw orderError;

    const { error: itemsError } = await admin
      .from("order_items")
      .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
    if (itemsError) {
      await admin.from("orders").delete().eq("id", order.id);
      throw itemsError;
    }

    // Best effort — never fails the request.
    const folio = order.id.slice(0, 8);
    const lines = orderItems
      .map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`)
      .join("");
    await sendEmail({
      to: await listAdminEmails(admin),
      subject: `Nueva cotización #${folio}`,
      html: `<p>${escapeHtml(customerName || "Un cliente")} solicitó una cotización.</p>
<ul>${lines}</ul>
<p>Entrega: ${escapeHtml(deliverySlot)} — ${escapeHtml(deliveryAddress)}</p>
<p>Ábrela en la app (Pedidos → Cotizaciones) para revisarla y enviarla.</p>`,
    });

    return json({ orderId: order.id });
  } catch (error) {
    console.error("create-quote failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
```

- [ ] **Step 2: Delete `create-order` and update config**

```bash
git rm -r supabase/functions/create-order
```

In `supabase/config.toml` replace:

```toml
[functions.create-order]
verify_jwt = true
```

with:

```toml
[functions.create-quote]
verify_jwt = true

[functions.quote-actions]
verify_jwt = true

[functions.admin-orders]
verify_jwt = true
```

- [ ] **Step 3: Deploy and smoke test**

```bash
npx supabase functions deploy create-quote
npx supabase secrets set RESEND_API_KEY=re_xxx QUOTES_FROM_EMAIL="LimpiezaApp <cotizaciones@yourdomain>"
```

Then with a signed-in user's access token (copy from the app's session, or `supabase.auth.getSession()` in a dev console):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/create-quote" \
  -H "Authorization: Bearer $USER_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"addressId":"<own address uuid>","deliverySlot":"Hoy, 6pm – 8pm","items":[{"productId":"<active product uuid>","quantity":2}]}'
```

Expected: `{"orderId":"..."}`; row in `orders` with `status = quote_requested`, `customer_name` filled, `paid_at` null; items with `catalog_price_cents = unit_price_cents`; an email at each admin address (or a "Email skipped" log line if secrets are missing). Delete the old `create-order` function in the dashboard (`npx supabase functions delete create-order`).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-quote supabase/config.toml
git commit -m "Replace create-order with create-quote: request a cotización instead of paying"
```

---

### Task 4: `quote-actions` Edge Function (customer pay / cancel)

**Files:**
- Create: `supabase/functions/quote-actions/index.ts`

**Interfaces:**
- Consumes: Task 2 helpers; `orders.mp_init_point` from Task 1.
- Produces: `POST quote-actions` body `{ action: "pay", orderId }` → `200 { initPoint: string }`; `{ action: "cancel", orderId }` → `200 { ok: true }`. Errors: `400`, `401`, `404 { error: "Cotización no encontrada" }`, `409 { error }` (wrong status / stock), `502` (MP), `503` (MP not configured).

- [ ] **Step 1: Write the function**

```ts
// quote-actions: the customer's two actions on their own cotización.
//   pay    — creates the Mercado Pago preference for the QUOTED total (single
//            line item: MP rejects negative discount lines) and moves the row
//            to `pending`; the webhook decides the outcome.
//   cancel — cancels an unpaid quote.
// Ownership is enforced by reading the order through the RLS-scoped client.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { getCaller } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const bodySchema = z.object({
  action: z.enum(["pay", "cancel"]),
  orderId: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { userClient, admin } = caller;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
    const { action, orderId } = parsed.data;

    // RLS: a customer can only see their own rows, so a foreign id is a 404.
    const { data: order, error: orderError } = await userClient
      .from("orders")
      .select("id, status, total_cents, mp_init_point, order_items ( product_id, name, quantity )")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json({ error: "Cotización no encontrada" }, 404);

    if (action === "cancel") {
      const { data: updated, error } = await admin
        .from("orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .in("status", ["quote_requested", "quote_sent"])
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return json({ error: "La cotización ya no se puede cancelar" }, 409);
      }
      return json({ ok: true });
    }

    // action === "pay"
    if (order.status === "pending" && order.mp_init_point) {
      // Customer closed the browser earlier; resume the same preference.
      return json({ initPoint: order.mp_init_point });
    }
    if (order.status !== "quote_sent" && order.status !== "pending") {
      return json({ error: "La cotización aún no está lista para pagar" }, 409);
    }

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpToken) {
      console.error("MP_ACCESS_TOKEN is not configured");
      return json({ error: "Pagos no configurados" }, 503);
    }

    // Stock re-check: the admin may have raised quantities, and time passed.
    const productIds = order.order_items.map((i) => i.product_id);
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, name, stock, is_active")
      .in("id", productIds);
    if (productsError) throw productsError;
    for (const item of order.order_items) {
      const product = products?.find((p) => p.id === item.product_id);
      if (!product || !product.is_active) {
        return json({ error: `Ya no disponible: ${item.name}` }, 409);
      }
      if (product.stock < item.quantity) {
        return json({ error: `Sin existencias: ${item.name}` }, 409);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const deepLink = `limpiezaapp://checkout/result?order_id=${order.id}`;
    const folio = order.id.slice(0, 8);
    const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
        // The quoted total may change between attempts (admin re-edit), so
        // the key includes it — MP would otherwise replay the old preference.
        "X-Idempotency-Key": `${order.id}-${order.total_cents}`,
      },
      body: JSON.stringify({
        items: [
          {
            id: order.id,
            title: `Cotización #${folio}`,
            quantity: 1,
            unit_price: order.total_cents / 100,
            currency_id: "MXN",
          },
        ],
        external_reference: order.id,
        notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
        back_urls: { success: deepLink, pending: deepLink, failure: deepLink },
        statement_descriptor: "LIMPIEZAAPP",
        metadata: { order_id: order.id },
      }),
    });
    if (!preferenceResponse.ok) {
      console.error("MP preference failed", await preferenceResponse.text());
      return json({ error: "No se pudo iniciar el pago" }, 502);
    }
    const preference = await preferenceResponse.json();

    const { data: updated, error: updateError } = await admin
      .from("orders")
      .update({
        status: "pending",
        mp_preference_id: preference.id,
        mp_init_point: preference.init_point,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .in("status", ["quote_sent", "pending"])
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return json({ error: "La cotización cambió, vuelve a intentarlo" }, 409);
    }

    return json({ initPoint: preference.init_point });
  } catch (error) {
    console.error("quote-actions failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
```

- [ ] **Step 2: Deploy and smoke test**

```bash
npx supabase functions deploy quote-actions
```

Using the order from Task 3 (still `quote_requested`):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/quote-actions" -H "Authorization: Bearer $USER_JWT" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"action":"pay","orderId":"<id>"}'
```

Expected: `409 {"error":"La cotización aún no está lista para pagar"}`. Manually `update orders set status='quote_sent' where id='<id>'` in the SQL editor, repeat → `200 {"initPoint":"https://…mercadopago…"}` and the row is `pending` with `mp_init_point` set. Repeat once more → same `initPoint` returned (resume path). Then `{"action":"cancel"}` → `409` (pending can't be cancelled). A second user's JWT on the same id → `404`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/quote-actions
git commit -m "Add quote-actions Edge Function: customer pays or cancels a cotización"
```

---

### Task 5: `admin-orders` Edge Function (list / edit / send / reject / advance)

**Files:**
- Create: `supabase/functions/admin-orders/index.ts`

**Interfaces:**
- Consumes: Task 1 `apply_quote_edit`; Task 2 helpers.
- Produces:
  - `GET admin-orders?kind=quotes|orders[&search=]` → `OrderWithItems[]` (orders rows + `order_items`), newest first.
  - `PATCH admin-orders` body `{ id, items: [{ id, quantity, unit_price_cents }], delivery_fee_cents, discount: { type: "amount", cents } | { type: "percent", value }, admin_note: string | null }` → `200 OrderWithItems`.
  - `POST admin-orders` body `{ id, action: "send" } | { id, action: "reject", note?: string } | { id, action: "advance", to: "preparing" | "delivering" | "delivered" }` → `200 OrderWithItems`.
  - Errors: `400`, `401`, `403 { error: "Prohibido" }`, `404`, `409 { error }` with the RPC's Spanish message.

- [ ] **Step 1: Write the function**

```ts
// admin-orders: everything an admin does with cotizaciones and pedidos.
// Gated on admin_users; all writes use the service role. Line-item edits go
// through the apply_quote_edit RPC so totals are recomputed atomically and
// only while the row is still an unpaid quote.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { getCaller, requireAdmin } from "../_shared/auth.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";

const ORDER_WITH_ITEMS = "*, order_items ( * )";

const patchSchema = z.object({
  id: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        unit_price_cents: z.number().int().min(0),
      })
    )
    .min(1)
    .max(50),
  delivery_fee_cents: z.number().int().min(0),
  discount: z.discriminatedUnion("type", [
    z.object({ type: z.literal("amount"), cents: z.number().int().min(0) }),
    z.object({ type: z.literal("percent"), value: z.number().int().min(0).max(100) }),
  ]),
  admin_note: z.string().max(1000).nullable(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.literal("send") }),
  z.object({ id: z.string().uuid(), action: z.literal("reject"), note: z.string().max(1000).optional() }),
  z.object({
    id: z.string().uuid(),
    action: z.literal("advance"),
    to: z.enum(["preparing", "delivering", "delivered"]),
  }),
]);

/** The only legal fulfillment steps, keyed by the status they start from. */
const NEXT_STATUS: Record<string, string> = {
  paid: "preparing",
  preparing: "delivering",
  delivering: "delivered",
};

Deno.serve(async (req) => {
  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { admin, user } = caller;
    if (!(await requireAdmin(admin, user.id))) return json({ error: "Prohibido" }, 403);

    const fetchOrder = async (id: string) => {
      const { data, error } = await admin
        .from("orders")
        .select(ORDER_WITH_ITEMS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    if (req.method === "GET") {
      const params = new URL(req.url).searchParams;
      const kind = params.get("kind") === "orders" ? "orders" : "quotes";
      const search = params.get("search")?.trim();
      let query = admin
        .from("orders")
        .select(ORDER_WITH_ITEMS)
        .order("created_at", { ascending: false });
      query = kind === "orders" ? query.not("paid_at", "is", null) : query.is("paid_at", null);
      if (search) {
        query = query.or(
          `customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return json(data);
    }

    if (req.method === "PATCH") {
      const parsed = patchSchema.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { id, items, delivery_fee_cents, discount, admin_note } = parsed.data;

      const { error } = await admin.rpc("apply_quote_edit", {
        p_order_id: id,
        p_items: items,
        p_delivery_fee_cents: delivery_fee_cents,
        p_discount_cents: discount.type === "amount" ? discount.cents : 0,
        p_discount_percent: discount.type === "percent" ? discount.value : null,
        p_admin_note: admin_note,
      });
      if (error) {
        // P0001 / P0002 carry the RPC's user-facing Spanish message.
        if (error.code === "P0001" || error.code === "P0002") {
          return json({ error: error.message }, 409);
        }
        throw error;
      }
      return json(await fetchOrder(id));
    }

    if (req.method === "POST") {
      const parsed = actionSchema.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const body = parsed.data;
      const now = new Date().toISOString();

      if (body.action === "send") {
        const { data: updated, error } = await admin
          .from("orders")
          .update({ status: "quote_sent", quoted_at: now, quoted_by: user.id, updated_at: now })
          .eq("id", body.id)
          .in("status", ["quote_requested", "quote_sent"])
          .select("id, customer_email, customer_name, total_cents");
        if (error) throw error;
        const row = updated?.[0];
        if (!row) return json({ error: "La cotización ya no se puede enviar" }, 409);

        if (row.customer_email) {
          const total = (row.total_cents / 100).toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN",
          });
          await sendEmail({
            to: [row.customer_email],
            subject: `Tu cotización #${row.id.slice(0, 8)} está lista`,
            html: `<p>Hola ${escapeHtml(row.customer_name || "")},</p>
<p>Tu cotización está lista por un total de <strong>${total}</strong>.</p>
<p>Ábrela en LimpiezaApp (Pedidos → Cotizaciones) para revisarla y pagarla.</p>`,
          });
        }
        return json(await fetchOrder(body.id));
      }

      if (body.action === "reject") {
        // An omitted/empty note keeps whatever note was saved through PATCH
        // (Android has no Alert.prompt, so the admin writes the reason there).
        const note = body.note?.trim();
        const { data: updated, error } = await admin
          .from("orders")
          .update({
            status: "cancelled",
            ...(note ? { admin_note: note } : {}),
            updated_at: now,
          })
          .eq("id", body.id)
          .in("status", ["quote_requested", "quote_sent"])
          .select("id");
        if (error) throw error;
        if (!updated || updated.length === 0) {
          return json({ error: "La cotización ya no se puede rechazar" }, 409);
        }
        return json(await fetchOrder(body.id));
      }

      // advance: only the single next step, guarded by the current status.
      const from = Object.keys(NEXT_STATUS).find((k) => NEXT_STATUS[k] === body.to)!;
      const { data: updated, error } = await admin
        .from("orders")
        .update({ status: body.to, updated_at: now })
        .eq("id", body.id)
        .eq("status", from)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return json({ error: "El pedido no está en el estado esperado" }, 409);
      }
      return json(await fetchOrder(body.id));
    }

    return json({ error: "Método no permitido" }, 405);
  } catch (error) {
    console.error("admin-orders failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
```

- [ ] **Step 2: Deploy and smoke test**

```bash
npx supabase functions deploy admin-orders
```

With an admin's JWT and the Task 3 order (reset it first: `update orders set status='quote_requested', mp_preference_id=null, mp_init_point=null where id='<id>'`):

1. `GET …/admin-orders?kind=quotes` → array containing the order with `order_items`.
2. `PATCH` with `items: [{ id: <item id>, quantity: 3, unit_price_cents: 4000 }], delivery_fee_cents: 0, discount: { type: "percent", value: 10 }, admin_note: "Precio especial"` → response `subtotal_cents = 12000`, `discount_cents = 1200`, `total_cents = 10800`, `discount_percent = 10`.
3. `PATCH` with `discount: { type: "amount", cents: 99999 }` → `409 "El descuento no puede superar el subtotal"`.
4. `POST { action: "send" }` → `status = quote_sent`, `quoted_by` = admin id; customer email received.
5. `POST { action: "advance", to: "preparing" }` → `409` (not paid).
6. Non-admin JWT on `GET` → `403`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-orders
git commit -m "Add admin-orders Edge Function: list, edit, send, reject, advance"
```

---

### Task 6: `mp-webhook` — set `paid_at`, return failed payments to `quote_sent`

**Files:**
- Modify: `supabase/functions/mp-webhook/index.ts` (the block after `if (order.status !== "pending")`)

**Interfaces:**
- Consumes: Task 1 columns `paid_at`, `mp_init_point`.
- Produces: `paid` rows always have `paid_at`; a rejected/cancelled payment leaves the quote payable again.

- [ ] **Step 1: Replace the transition block**

Replace:

```ts
    if (payment.status === "approved") {
      const { data: updated } = await admin
        .from("orders")
        .update({ status: "paid", mp_payment_id: String(payment.id) })
        .eq("id", orderId)
        .eq("status", "pending") // guard against concurrent notifications
        .select("id");
      if (updated && updated.length > 0) {
        await admin.rpc("decrement_stock_for_order", { p_order_id: orderId });
      }
    } else if (["rejected", "cancelled"].includes(payment.status)) {
      await admin
        .from("orders")
        .update({ status: "cancelled", mp_payment_id: String(payment.id) })
        .eq("id", orderId)
        .eq("status", "pending");
    }
    // pending / in_process: leave the order as pending.
```

with:

```ts
    const now = new Date().toISOString();
    if (payment.status === "approved") {
      // paid_at is what turns a cotización into a pedido — set only here.
      const { data: updated } = await admin
        .from("orders")
        .update({
          status: "paid",
          paid_at: now,
          updated_at: now,
          mp_payment_id: String(payment.id),
        })
        .eq("id", orderId)
        .eq("status", "pending") // guard against concurrent notifications
        .select("id");
      if (updated && updated.length > 0) {
        await admin.rpc("decrement_stock_for_order", { p_order_id: orderId });
      }
    } else if (["rejected", "cancelled"].includes(payment.status)) {
      // The quote survives a failed payment: back to quote_sent so the
      // customer can retry, with the stale preference cleared.
      await admin
        .from("orders")
        .update({
          status: "quote_sent",
          mp_payment_id: String(payment.id),
          mp_preference_id: null,
          mp_init_point: null,
          updated_at: now,
        })
        .eq("id", orderId)
        .eq("status", "pending");
    }
    // pending / in_process: leave the order as pending.
```

Also update the header comment's last line to: `// Idempotent: repeated notifications cannot double-fulfill an order. A failed payment returns the row to quote_sent (never cancelled).`

- [ ] **Step 2: Deploy and verify**

```bash
npx supabase functions deploy mp-webhook --no-verify-jwt
```

Full verification happens in Task 17's end-to-end run (needs the app). For now confirm the deploy succeeds and the function logs show no startup error (`npx supabase functions logs mp-webhook` or the dashboard).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/mp-webhook/index.ts
git commit -m "mp-webhook: set paid_at on approval, return failed payments to quote_sent"
```

---

### Task 7: App types, status rules and money helpers

**Files:**
- Modify: `models/types.ts`
- Modify: `models/orderStatus.ts`
- Modify: `utils/format.ts`
- Modify: `models/delivery.ts` (comment only)

**Interfaces:**
- Produces (types): `OrderStatus` adds `"quote_requested" | "quote_sent"`; `Order` adds `discount_cents: number; discount_percent: number | null; admin_note: string | null; customer_name: string; customer_phone: string | null; customer_email: string; paid_at: string | null; quoted_at: string | null; quoted_by: string | null; mp_init_point: string | null`; `OrderItem` adds `catalog_price_cents: number`; new `DiscountInput = { type: "amount"; cents: number } | { type: "percent"; value: number }`; `QuoteEditInput = { items: { id: string; quantity: number; unit_price_cents: number }[]; delivery_fee_cents: number; discount: DiscountInput; admin_note: string | null }`; `FulfillmentStatus = "preparing" | "delivering" | "delivered"`; `OrderKind = "quotes" | "orders"`.
- Produces (orderStatus): `isQuote(order: Pick<Order, "paid_at">): boolean`, `canPay(status)`, `canCancelQuote(status)`, `isQuoteEditable(status)`, `nextFulfillmentStatus(status): FulfillmentStatus | null`, `computeTotals(input: { items: { quantity: number; unit_price_cents: number }[]; discount: DiscountInput; deliveryFeeCents: number }): { subtotal: number; discount: number; deliveryFee: number; total: number }`, plus labels/styles for the two new statuses.
- Produces (format): `parseMXNInput(text: string): number | null` (cents).

- [ ] **Step 1: Update `models/types.ts`**

Replace the `OrderStatus`, `Order`, `OrderItem` definitions with:

```ts
export type OrderStatus =
  | "quote_requested"
  | "quote_sent"
  | "pending"
  | "paid"
  | "preparing"
  | "delivering"
  | "delivered"
  | "cancelled";

/** Fulfillment steps an admin can advance a paid order through, in order. */
export type FulfillmentStatus = "preparing" | "delivering" | "delivered";

/** Pedidos-tab filter: cotizaciones (unpaid) vs pedidos (paid). */
export type OrderKind = "quotes" | "orders";

export interface Order {
  id: string;
  user_id: string;
  address_id: string | null;
  delivery_address: string;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  /** Set when the admin entered the discount as a percentage. */
  discount_percent: number | null;
  delivery_fee_cents: number;
  total_cents: number;
  delivery_slot: string;
  /** Admin's note to the customer (or the rejection reason). */
  admin_note: string | null;
  /** Customer snapshot taken at request time. */
  customer_name: string;
  customer_phone: string | null;
  customer_email: string;
  /** Non-null ⇔ this row is a pedido (payment confirmed by the webhook). */
  paid_at: string | null;
  quoted_at: string | null;
  quoted_by: string | null;
  mp_preference_id: string | null;
  mp_init_point: string | null;
  mp_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  /** Snapshot at request time — survives product deactivation. */
  name: string;
  quantity: number;
  /** Admin-editable quoted price. */
  unit_price_cents: number;
  /** Catalog price when the quote was requested. */
  catalog_price_cents: number;
}

export type DiscountInput =
  | { type: "amount"; cents: number }
  | { type: "percent"; value: number };

/** Body of an admin quote edit (mirrors admin-orders PATCH). */
export interface QuoteEditInput {
  items: { id: string; quantity: number; unit_price_cents: number }[];
  delivery_fee_cents: number;
  discount: DiscountInput;
  admin_note: string | null;
}
```

Keep `OrderWithItems`, `Profile`, `Address`, `Category`, `Product`, `AdminProduct`, `AdminCategory` as they are.

- [ ] **Step 2: Rewrite `models/orderStatus.ts`**

```ts
// MODEL — order-status domain rules: display labels, badge styles, state
// predicates and the single money formula shared by every screen that
// renders or edits an order/cotización.
import type {
  DiscountInput,
  FulfillmentStatus,
  Order,
  OrderStatus,
} from "@/models/types";

/** A row is a cotización until the webhook confirms payment. */
export const isQuote = (order: Pick<Order, "paid_at">) => order.paid_at === null;

/** Payment has been resolved one way or the other (webhook already ran). */
export const isPaymentSettled = (status: OrderStatus) => status !== "pending";

/** The order can never change again — stop polling. */
export const isFinal = (status: OrderStatus) =>
  status === "delivered" || status === "cancelled";

/** Customer may start (or resume) a Mercado Pago payment. */
export const canPay = (status: OrderStatus) =>
  status === "quote_sent" || status === "pending";

/** Customer may cancel; admin may reject / edit / send. */
export const canCancelQuote = (status: OrderStatus) =>
  status === "quote_requested" || status === "quote_sent";
export const isQuoteEditable = canCancelQuote;

const FULFILLMENT_NEXT: Partial<Record<OrderStatus, FulfillmentStatus>> = {
  paid: "preparing",
  preparing: "delivering",
  delivering: "delivered",
};

/** The one status an admin may advance a paid order to, or null. */
export const nextFulfillmentStatus = (status: OrderStatus) =>
  FULFILLMENT_NEXT[status] ?? null;

export interface Totals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

/**
 * The money rule, identical to apply_quote_edit in the database:
 * total = subtotal − discount + delivery fee, never below zero.
 * Used for live totals in the admin editor; the server result is authoritative.
 */
export function computeTotals(input: {
  items: { quantity: number; unit_price_cents: number }[];
  discount: DiscountInput;
  deliveryFeeCents: number;
}): Totals {
  const subtotal = input.items.reduce(
    (sum, i) => sum + i.quantity * i.unit_price_cents,
    0
  );
  const discount =
    input.discount.type === "percent"
      ? Math.round((subtotal * input.discount.value) / 100)
      : Math.min(input.discount.cents, subtotal);
  const total = Math.max(subtotal - discount + input.deliveryFeeCents, 0);
  return { subtotal, discount, deliveryFee: input.deliveryFeeCents, total };
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  quote_requested: "Nueva cotización",
  quote_sent: "Cotización enviada",
  pending: "Pago pendiente",
  paid: "Pagado",
  preparing: "Preparando",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/** [badge background class, badge text class] */
export const STATUS_STYLES: Record<OrderStatus, [string, string]> = {
  quote_requested: ["bg-citrus/20", "text-citrus"],
  quote_sent: ["bg-tide/15", "text-tide"],
  pending: ["bg-citrus/20", "text-citrus"],
  paid: ["bg-primary/15", "text-primary"],
  preparing: ["bg-tide/15", "text-tide"],
  delivering: ["bg-tide/15", "text-tide"],
  delivered: ["bg-primary/15", "text-primary"],
  cancelled: ["bg-coral/15", "text-coral"],
};

export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  preparing: "Preparando",
  delivering: "En camino",
  delivered: "Entregado",
};
```

- [ ] **Step 3: Add `parseMXNInput` to `utils/format.ts`**

Append:

```ts
/**
 * Parses a pesos string typed by a user ("120", "120.5", "$1,200.50") into
 * integer cents. Returns null when the text isn't a non-negative amount.
 */
export function parseMXNInput(text: string): number | null {
  const cleaned = text.replace(/[^0-9.,]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Inverse of parseMXNInput for prefilling inputs: 12050 -> "120.50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
```

- [ ] **Step 4: Update the comment in `models/delivery.ts`**

Replace the first two lines with:

```ts
// Display-only values. The authoritative rule lives in
// supabase/functions/_shared/delivery.ts (used by create-quote) — keep both in sync.
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files that still reference `createOrder` / old shapes (`controllers/useCheckout.ts`, `models/paymentModel.ts` untouched so far are fine; if `orders.tsx`/`order/[id].tsx` compile, good). No errors inside the four files edited here.

- [ ] **Step 6: Commit**

```bash
git add models/types.ts models/orderStatus.ts utils/format.ts models/delivery.ts
git commit -m "Add quote statuses, order quote fields, money helpers and status predicates"
```

---

### Task 8: Client models — function errors, quote, payment, admin orders, PDF document

**Files:**
- Create: `models/functionError.ts`
- Create: `models/quoteModel.ts`
- Modify: `models/paymentModel.ts`
- Modify: `models/adminModel.ts` (export `invokeAdminFunction`, widen its union)
- Create: `models/adminOrderModel.ts`
- Create: `models/quoteDocument.ts`

**Interfaces:**
- Consumes: Task 7 types; Tasks 3–5 Edge Functions.
- Produces:
  - `functionErrorMessage(error: unknown, fallback: string): Promise<string>`
  - `requestQuote(request: QuoteRequest): Promise<{ orderId: string }>`, `cancelQuote(orderId: string): Promise<void>` where `QuoteRequest = { addressId: string; deliverySlot: string; items: { productId: string; quantity: number }[] }`
  - `payQuote(orderId: string): Promise<{ initPoint: string }>`, `openMercadoPagoCheckout(initPoint)` (unchanged)
  - `listAdminOrders(kind: OrderKind, search?: string): Promise<OrderWithItems[]>`, `updateQuote(id, input: QuoteEditInput): Promise<OrderWithItems>`, `sendQuote(id): Promise<OrderWithItems>`, `rejectQuote(id, note?: string): Promise<OrderWithItems>`, `advanceOrder(id, to: FulfillmentStatus): Promise<OrderWithItems>`
  - `buildQuoteHtml(order: OrderWithItems): string`

- [ ] **Step 1: `models/functionError.ts`**

```ts
// MODEL — Edge Function error decoding. supabase.functions.invoke wraps a
// non-2xx response in FunctionsHttpError with the Response in `context`;
// our functions always answer { error: "<Spanish message>" }, which is safe
// to show the user (stock names, status conflicts...).
import { FunctionsHttpError } from "@supabase/supabase-js";

export async function functionErrorMessage(
  error: unknown,
  fallback: string
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await (error.context as Response).json();
      if (body && typeof body.error === "string" && body.error) return body.error;
    } catch {
      // Non-JSON body: fall through to the generic message.
    }
  }
  return fallback;
}
```

- [ ] **Step 2: `models/quoteModel.ts`**

```ts
// MODEL — cotizaciones (customer side). The client only ever sends product
// ids + quantities; the create-quote Edge Function recomputes every price.
import { functionErrorMessage } from "@/models/functionError";
import { supabase } from "@/services/supabase";

export interface QuoteRequest {
  addressId: string;
  deliverySlot: string;
  items: { productId: string; quantity: number }[];
}

/** Creates a cotización from the cart. Returns the new order id. */
export async function requestQuote(request: QuoteRequest): Promise<{ orderId: string }> {
  const { data, error } = await supabase.functions.invoke("create-quote", {
    body: request,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo enviar la cotización. Intenta de nuevo.")
    );
  }
  return data as { orderId: string };
}

/** Cancels the caller's own unpaid cotización. */
export async function cancelQuote(orderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "cancel", orderId },
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo cancelar la cotización.")
    );
  }
}
```

- [ ] **Step 3: Rewrite `models/paymentModel.ts`**

```ts
// MODEL — payments: the client side of the Mercado Pago flow for a
// cotización the admin already sent. The quote-actions Edge Function builds
// the preference from the quoted total stored server-side, and payment
// truth comes exclusively from the mp-webhook Edge Function.
import * as WebBrowser from "expo-web-browser";

import { functionErrorMessage } from "@/models/functionError";
import { supabase } from "@/services/supabase";

/** Starts (or resumes) the payment of a sent cotización. */
export async function payQuote(orderId: string): Promise<{ initPoint: string }> {
  const { data, error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "pay", orderId },
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo iniciar el pago. Intenta de nuevo.")
    );
  }
  return data as { initPoint: string };
}

/**
 * Opens Mercado Pago checkout in an in-app browser (Custom Tabs / Safari
 * View Controller). Resolves when the limpiezaapp:// deep link fires or
 * the user closes the browser. The result URL is only used for navigation
 * — the order row (updated by the webhook) decides the real outcome.
 */
export async function openMercadoPagoCheckout(initPoint: string) {
  return WebBrowser.openAuthSessionAsync(initPoint, "limpiezaapp://checkout/result");
}
```

- [ ] **Step 4: Export the invoke helper from `models/adminModel.ts`**

Change the private helper's signature and export it:

```ts
export async function invokeAdminFunction<T>(
  fn: "admin-products" | "admin-categories" | "admin-orders",
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  query?: Record<string, string | undefined>
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const { data, error } = await supabase.functions.invoke(`${fn}${suffix}`, {
    method,
    body: body as Record<string, unknown> | undefined,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo completar la operación. Intenta de nuevo.")
    );
  }
  return data as T;
}
```

Add `import { functionErrorMessage } from "@/models/functionError";` at the top, and update the one existing caller that passed `search` positionally:

```ts
export async function listAllProducts(search?: string): Promise<AdminProduct[]> {
  return invokeAdminFunction<AdminProduct[]>("admin-products", "GET", undefined, { search });
}
```

- [ ] **Step 5: `models/adminOrderModel.ts`**

```ts
// MODEL — admin orders: everyone's cotizaciones/pedidos, and the admin's
// actions on them. Every call goes through the admin-orders Edge Function
// (orders RLS stays client-read-only). Only used from admin-gated controllers.
import { invokeAdminFunction } from "@/models/adminModel";
import type {
  FulfillmentStatus,
  OrderKind,
  OrderWithItems,
  QuoteEditInput,
} from "@/models/types";

/** All rows of one kind (quotes = unpaid, orders = paid), newest first. */
export async function listAdminOrders(
  kind: OrderKind,
  search?: string
): Promise<OrderWithItems[]> {
  return invokeAdminFunction<OrderWithItems[]>("admin-orders", "GET", undefined, {
    kind,
    search,
  });
}

/** Replaces line items / fee / discount / note of an unpaid quote. */
export async function updateQuote(id: string, input: QuoteEditInput): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "PATCH", { id, ...input });
}

/** Marks the quote as sent (emails the customer). */
export async function sendQuote(id: string): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", { id, action: "send" });
}

/** Rejects an unpaid quote with an optional note shown to the customer. */
export async function rejectQuote(id: string, note?: string): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", {
    id,
    action: "reject",
    note,
  });
}

/** Advances a paid order one fulfillment step. */
export async function advanceOrder(
  id: string,
  to: FulfillmentStatus
): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", {
    id,
    action: "advance",
    to,
  });
}
```

- [ ] **Step 6: `models/quoteDocument.ts`**

```ts
// MODEL — cotización document: pure HTML rendering of an order for the PDF
// export. No React Native imports; inline CSS only (expo-print renders it in
// a WebView). Money is formatted here from integer cents.
import { STATUS_LABELS } from "@/models/orderStatus";
import type { OrderWithItems } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Builds the printable HTML for a cotización / pedido. */
export function buildQuoteHtml(order: OrderWithItems): string {
  const folio = order.id.slice(0, 8).toUpperCase();
  const title = order.paid_at ? "Pedido" : "Cotización";
  const rows = order.order_items
    .map(
      (i) => `<tr>
  <td class="qty">${i.quantity}</td>
  <td>${esc(i.name)}</td>
  <td class="num">${formatMXN(i.unit_price_cents)}</td>
  <td class="num">${formatMXN(i.unit_price_cents * i.quantity)}</td>
</tr>`
    )
    .join("");
  const discountLabel =
    order.discount_percent != null ? `Descuento (${order.discount_percent}%)` : "Descuento";
  const discountRow =
    order.discount_cents > 0
      ? `<tr><td colspan="3" class="label">${discountLabel}</td><td class="num">−${formatMXN(order.discount_cents)}</td></tr>`
      : "";
  const feeText = order.delivery_fee_cents === 0 ? "Gratis" : formatMXN(order.delivery_fee_cents);
  const note = order.admin_note
    ? `<section class="note"><h3>Nota</h3><p>${esc(order.admin_note)}</p></section>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #10241F; margin: 32px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #3E8368; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 22px; color: #3E8368; }
  h2 { margin: 4px 0 0; font-size: 16px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #3E8368; margin: 0 0 6px; }
  .meta { text-align: right; color: #55625E; }
  .cols { display: flex; gap: 24px; margin-bottom: 20px; }
  .cols section { flex: 1; }
  p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #55625E; border-bottom: 1px solid #DDE3E0; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #EEF2F0; vertical-align: top; }
  .qty { width: 40px; }
  .num { text-align: right; white-space: nowrap; }
  .label { text-align: right; color: #55625E; }
  tfoot td { border: none; }
  tfoot tr.total td { font-weight: bold; font-size: 15px; border-top: 2px solid #3E8368; }
  .note { margin-top: 20px; background: #F5F7F5; padding: 12px; border-radius: 8px; }
  footer { margin-top: 32px; font-size: 11px; color: #55625E; }
</style></head><body>
<header>
  <div><h1>LimpiezaApp</h1><h2>${title} #${folio}</h2></div>
  <div class="meta"><p>${esc(formatDate(order.created_at))}</p><p>${esc(STATUS_LABELS[order.status])}</p></div>
</header>
<div class="cols">
  <section><h3>Cliente</h3>
    <p>${esc(order.customer_name || "—")}</p>
    <p>${esc(order.customer_phone ?? "")}</p>
    <p>${esc(order.customer_email)}</p>
  </section>
  <section><h3>Entrega</h3>
    <p>${esc(order.delivery_address)}</p>
    <p>${esc(order.delivery_slot)}</p>
  </section>
</div>
<table>
  <thead><tr><th>Cant.</th><th>Producto</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="3" class="label">Subtotal</td><td class="num">${formatMXN(order.subtotal_cents)}</td></tr>
    ${discountRow}
    <tr><td colspan="3" class="label">Envío</td><td class="num">${feeText}</td></tr>
    <tr class="total"><td colspan="3" class="label">Total</td><td class="num">${formatMXN(order.total_cents)}</td></tr>
  </tfoot>
</table>
${note}
<footer>Precios en MXN. Esta cotización es válida hasta que el pedido sea confirmado y pagado en la app.</footer>
</body></html>`;
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in `controllers/useCheckout.ts` (imports `createOrder`, removed). Everything else clean. If `String.prototype.replaceAll` is flagged, add `"lib": ["ES2021", "DOM"]` is NOT needed — Expo's tsconfig already targets ESNext; if it is flagged anyway, replace `replaceAll("x", "y")` with `replace(/x/g, "y")`.

- [ ] **Step 8: Commit**

```bash
git add models/functionError.ts models/quoteModel.ts models/paymentModel.ts models/adminModel.ts models/adminOrderModel.ts models/quoteDocument.ts
git commit -m "Add quote, payment, admin-order and PDF document models"
```

---

### Task 9: Controllers — checkout, quote actions, orders by kind, admin orders, PDF

**Files:**
- Modify: `controllers/useCheckout.ts`
- Create: `controllers/useQuote.ts`
- Modify: `controllers/useOrders.ts`
- Create: `controllers/useAdminOrders.ts`
- Create: `controllers/useQuotePdf.ts`
- Modify: `package.json` via `npx expo install expo-print expo-sharing`

**Interfaces:**
- Consumes: Task 8 models; Task 7 predicates.
- Produces:
  - `useCheckout(): { requestQuote(addressId: string | null, deliverySlot: string): Promise<void>; submitting: boolean }`
  - `usePayQuote(): UseMutationResult<void, Error, string>` (arg = orderId), `useCancelQuote(): UseMutationResult<void, Error, string>`
  - `useOrders(kind: OrderKind, enabled = true)` (customer, filtered client-side), `useOrder(id)`, `useOrderPaymentStatus(id)` (unchanged signatures)
  - `useAdminOrders(kind: OrderKind, search?: string, enabled = true)`, `useUpdateQuote()` (arg `{ id, input: QuoteEditInput }`), `useSendQuote()` (arg id), `useRejectQuote()` (arg `{ id, note?: string }`), `useAdvanceOrder()` (arg `{ id, to: FulfillmentStatus }`)
  - `useQuotePdf(): { download(order: OrderWithItems): Promise<void>; generating: boolean }`

- [ ] **Step 1: Install the two native modules**

Run: `npx expo install expo-print expo-sharing`
Expected: both added to `package.json` dependencies at the SDK 57 compatible versions.

- [ ] **Step 2: Rewrite `controllers/useCheckout.ts`**

```ts
// CONTROLLER — checkout: turns the cart into a cotización. The view only
// calls requestQuote(); this controller builds the request from the cart
// model, asks the server to create the quote (prices recomputed there),
// clears the cart and navigates to the result screen, which shows the
// "cotización enviada" state for a quote_requested row.
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { useCart } from "@/controllers/useCart";
import { requestQuote as requestQuoteModel } from "@/models/quoteModel";

export function useCheckout() {
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const [submitting, setSubmitting] = useState(false);

  /** Sends the current cart as a cotización. */
  const requestQuote = async (addressId: string | null, deliverySlot: string) => {
    if (!addressId) {
      Alert.alert("Falta dirección", "Agrega una dirección de entrega.");
      return;
    }
    if (items.length === 0) {
      router.back();
      return;
    }
    setSubmitting(true);
    try {
      const { orderId } = await requestQuoteModel({
        addressId,
        deliverySlot,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      // The quote now lives in Pedidos → Cotizaciones; the cart is done.
      clearCart();
      router.replace({ pathname: "/checkout/result", params: { order_id: orderId } });
    } catch (error) {
      Alert.alert("Error", error instanceof Error ? error.message : "Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return { requestQuote, submitting };
}
```

- [ ] **Step 3: `controllers/useQuote.ts`**

```ts
// CONTROLLER — customer actions on their own cotización: pay (opens Mercado
// Pago, then lands on the result screen which polls the webhook outcome)
// and cancel. Both refresh the orders cache.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";

import { openMercadoPagoCheckout, payQuote } from "@/models/paymentModel";
import { cancelQuote } from "@/models/quoteModel";

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["orders"] });
}

/** Starts the Mercado Pago payment for a sent quote. Arg: order id. */
export function usePayQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { initPoint } = await payQuote(orderId);
      await openMercadoPagoCheckout(initPoint);
      router.replace({ pathname: "/checkout/result", params: { order_id: orderId } });
    },
    onSettled: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}

/** Cancels an unpaid quote. Arg: order id. */
export function useCancelQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (orderId: string) => cancelQuote(orderId),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}
```

- [ ] **Step 4: Update `controllers/useOrders.ts`**

```ts
// CONTROLLER — orders: read-only order history with smart polling that
// stops once an order reaches a state that can no longer change.
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import { fetchOrder, fetchOrders } from "@/models/orderModel";
import { isFinal, isPaymentSettled, isQuote } from "@/models/orderStatus";
import type { OrderKind, OrderWithItems } from "@/models/types";

/**
 * The caller's rows of one kind, newest first. One fetch serves both
 * filters: the split is derived from paid_at client-side.
 */
export function useOrders(kind: OrderKind, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["orders", session?.user.id],
    enabled: !!session && enabled,
    queryFn: fetchOrders,
    select: (orders) => orders.filter((o) => (kind === "quotes" ? isQuote(o) : !isQuote(o))),
  });
}

type OrderQueryState = { state: { data?: OrderWithItems | null } };

/**
 * One order with items (admins can read any row through RLS). Polls every
 * 5s while fulfillment is in progress, every 15s while it is an unpaid
 * quote waiting on the other party, and stops on delivered/cancelled.
 */
export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: (query: OrderQueryState) => {
      const order = query.state.data;
      if (!order) return 5000;
      if (isFinal(order.status)) return false;
      return isQuote(order) && order.status !== "pending" ? 15000 : 5000;
    },
    queryFn: () => fetchOrder(id!),
  });
}

/**
 * Same order query tuned for the result screen: polls every 3s only while
 * a payment is pending (the webhook settles it), then stops.
 */
export function useOrderPaymentStatus(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: (query: OrderQueryState) => {
      const order = query.state.data;
      return order && isPaymentSettled(order.status) ? false : 3000;
    },
    queryFn: () => fetchOrder(id!),
  });
}
```

- [ ] **Step 5: `controllers/useAdminOrders.ts`**

```ts
// CONTROLLER — admin orders: everyone's cotizaciones/pedidos plus the
// admin's edit/send/reject/advance actions. Only mounted behind useIsAdmin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import {
  advanceOrder,
  listAdminOrders,
  rejectQuote,
  sendQuote,
  updateQuote,
} from "@/models/adminOrderModel";
import type { FulfillmentStatus, OrderKind, QuoteEditInput } from "@/models/types";

/** All rows of one kind, newest first. `enabled` = false for non-admin mounts. */
export function useAdminOrders(kind: OrderKind, search?: string, enabled = true) {
  return useQuery({
    queryKey: ["admin-orders", kind, search ?? ""],
    queryFn: () => listAdminOrders(kind, search),
    enabled,
  });
}

/** Admin list AND the customer-facing caches (a customer may be an admin too). */
function useInvalidateAllOrders() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
}

export function useUpdateQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuoteEditInput }) => updateQuote(id, input),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se guardó", error.message),
  });
}

export function useSendQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: (id: string) => sendQuote(id),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se envió", error.message),
  });
}

export function useRejectQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => rejectQuote(id, note),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se rechazó", error.message),
  });
}

export function useAdvanceOrder() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: FulfillmentStatus }) => advanceOrder(id, to),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se actualizó", error.message),
  });
}
```

- [ ] **Step 6: `controllers/useQuotePdf.ts`**

```ts
// CONTROLLER — PDF export of a cotización/pedido. Native: render to a file
// and hand it to the OS share sheet (save / AirDrop / mail). Web: the
// browser print dialog, where "Guardar como PDF" is the download.
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Platform } from "react-native";

import { buildQuoteHtml } from "@/models/quoteDocument";
import type { OrderWithItems } from "@/models/types";

export function useQuotePdf() {
  const [generating, setGenerating] = useState(false);

  const download = async (order: OrderWithItems) => {
    setGenerating(true);
    try {
      const html = buildQuoteHtml(order);
      if (Platform.OS === "web") {
        await Print.printAsync({ html });
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("PDF generado", `Guardado en: ${uri}`);
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: `Cotización #${order.id.slice(0, 8).toUpperCase()}`,
      });
    } catch (error) {
      Alert.alert(
        "No se pudo generar el PDF",
        error instanceof Error ? error.message : "Intenta de nuevo."
      );
    } finally {
      setGenerating(false);
    }
  };

  return { download, generating };
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in `app/(protected)/checkout/index.tsx` (`pay`/`paying` no longer exist) and `app/(protected)/(tabs)/orders.tsx` (`useOrders` now requires `kind`). Fixed in Tasks 11–12.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json controllers/useCheckout.ts controllers/useQuote.ts controllers/useOrders.ts controllers/useAdminOrders.ts controllers/useQuotePdf.ts
git commit -m "Add quote/admin-order/PDF controllers; checkout now requests a cotización"
```

---

### Task 10: Shared views — `OrderTotals`, `OrderCard`

**Files:**
- Create: `views/OrderTotals.tsx`
- Create: `views/OrderCard.tsx`

**Interfaces:**
- Consumes: Task 7 `Totals`, `STATUS_LABELS`, `STATUS_STYLES`; `formatMXN`, `formatDate`.
- Produces:
  - `OrderTotals({ subtotal, discount, discountPercent, deliveryFee, total }: { subtotal: number; discount: number; discountPercent?: number | null; deliveryFee: number; total: number })`
  - `OrderCard({ order, showCustomer, onPress }: { order: Order; showCustomer?: boolean; onPress: () => void })`

- [ ] **Step 1: `views/OrderTotals.tsx`**

```tsx
import { Text, View } from "react-native";

import { formatMXN } from "@/utils/format";

interface Props {
  subtotal: number;
  discount: number;
  discountPercent?: number | null;
  deliveryFee: number;
  total: number;
}

/** VIEW — subtotal / descuento / envío / total block shared by every order screen. */
export function OrderTotals({ subtotal, discount, discountPercent, deliveryFee, total }: Props) {
  return (
    <View className="mt-2 border-t border-dark-100/5 pt-2">
      <Row label="Subtotal" value={formatMXN(subtotal)} />
      {discount > 0 ? (
        <Row
          label={discountPercent != null ? `Descuento (${discountPercent}%)` : "Descuento"}
          value={`−${formatMXN(discount)}`}
          accent
        />
      ) : null}
      <Row label="Envío" value={deliveryFee === 0 ? "Gratis" : formatMXN(deliveryFee)} />
      <View className="mt-1 flex-row justify-between">
        <Text className="font-quicksand-bold text-base text-dark-100">Total</Text>
        <Text className="font-quicksand-bold text-base text-dark-100">{formatMXN(total)}</Text>
      </View>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View className="mt-1 flex-row justify-between">
      <Text className="font-quicksand-medium text-dark-100/60">{label}</Text>
      <Text className={`font-quicksand-semibold ${accent ? "text-primary" : "text-dark-100"}`}>
        {value}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: `views/OrderCard.tsx`**

```tsx
import { Pressable, Text, View } from "react-native";

import { STATUS_LABELS, STATUS_STYLES } from "@/models/orderStatus";
import type { Order } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";

interface Props {
  order: Order;
  /** Admins see whose order it is. */
  showCustomer?: boolean;
  onPress: () => void;
}

/** VIEW — one row of the Pedidos tab (cotización or pedido). */
export function OrderCard({ order, showCustomer, onPress }: Props) {
  const [badgeBg, badgeText] = STATUS_STYLES[order.status];
  const isNew = order.status === "quote_requested";
  const kindLabel = order.paid_at ? "Pedido" : "Cotización";

  return (
    <Pressable
      onPress={onPress}
      className={`mb-3 rounded-2xl bg-white p-4 ${isNew ? "border border-citrus/60" : ""}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-quicksand-bold text-dark-100">
          {kindLabel} #{order.id.slice(0, 8)}
        </Text>
        <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
          <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
            {STATUS_LABELS[order.status]}
          </Text>
        </View>
      </View>
      {showCustomer ? (
        <Text className="mt-1 font-quicksand-semibold text-sm text-dark-100">
          {order.customer_name || order.customer_email}
        </Text>
      ) : null}
      <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
        {formatDate(order.created_at)}
      </Text>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.delivery_slot}</Text>
        <Text className="font-quicksand-bold text-base text-dark-100">
          {formatMXN(order.total_cents)}
        </Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 3: Typecheck the two files**

Run: `npx tsc --noEmit`
Expected: no errors in `views/OrderTotals.tsx` or `views/OrderCard.tsx` (the earlier known screen errors remain).

- [ ] **Step 4: Commit**

```bash
git add views/OrderTotals.tsx views/OrderCard.tsx
git commit -m "Add OrderTotals and OrderCard shared views"
```

---

### Task 11: Checkout and result screens

**Files:**
- Modify: `app/(protected)/checkout/index.tsx`
- Modify: `app/(protected)/checkout/result.tsx`

**Interfaces:**
- Consumes: Task 9 `useCheckout` (`requestQuote`, `submitting`); Task 10 `OrderTotals`; `useOrderPaymentStatus`.

- [ ] **Step 1: Update the checkout screen**

In `app/(protected)/checkout/index.tsx`:

1. Change `const { pay, paying } = useCheckout();` → `const { requestQuote, submitting } = useCheckout();`
2. Add `import { OrderTotals } from "@/views/OrderTotals";` and replace the whole `<View className="mt-2 border-t border-dark-100/5 pt-2"> … </View>` totals block (Subtotal / Envío / Total rows) with:

```tsx
          <OrderTotals subtotal={subtotal} discount={0} deliveryFee={deliveryFee} total={total} />
```

3. Replace the footnote text with:

```tsx
        <Text className="mt-3 text-center font-quicksand-medium text-xs text-dark-100/50">
          Un asesor confirmará precios y disponibilidad. Te avisaremos cuando tu
          cotización esté lista para pagar; el envío mostrado es estimado.
        </Text>
```

4. Replace the footer button with:

```tsx
        <PrimaryButton
          title={`Solicitar cotización · ${formatMXN(total)}`}
          onPress={() => requestQuote(addressId, slot)}
          loading={submitting}
          disabled={items.length === 0}
        />
```

5. Update the header docblock: "The request itself is fully handled by the checkout controller; totals shown here are estimates (the server recomputes and the admin may adjust them)." and the screen title to `<ScreenHeader title="Solicitar cotización" />`.

- [ ] **Step 2: Rewrite the result screen**

```tsx
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrderPaymentStatus } from "@/controllers/useOrders";
import { PrimaryButton } from "@/views/PrimaryButton";

/**
 * VIEW — outcome screen for both "cotización enviada" and the Mercado Pago
 * return. The deep link params are NEVER trusted to decide anything — only
 * the order row (updated by the mp-webhook Edge Function) is. The controller
 * polls it only while a payment is pending.
 */
export default function CheckoutResult() {
  const { order_id: orderId } = useLocalSearchParams<{ order_id: string }>();
  const { data: order } = useOrderPaymentStatus(orderId);
  const status = order?.status;

  if (!order || status === "pending") {
    return (
      <Shell>
        <ActivityIndicator size="large" color="#3E8368" />
        <Title>{order ? "Confirmando tu pago…" : "Cargando…"}</Title>
        {order ? (
          <Subtitle>
            Esto puede tardar unos momentos. Si pagaste en efectivo (OXXO), tu pedido se
            confirmará cuando se acredite el pago.
          </Subtitle>
        ) : null}
        <View className="mt-8 w-full">
          <PrimaryButton title="Ver mis pedidos" onPress={() => router.replace("/orders")} />
        </View>
      </Shell>
    );
  }

  if (status === "quote_requested") {
    return (
      <Shell>
        <Badge color="primary" icon="paper-plane" />
        <Title>¡Cotización enviada!</Title>
        <Subtitle>
          Un asesor la revisará y te avisaremos cuando esté lista para pagar. Puedes seguirla
          en Pedidos → Cotizaciones.
        </Subtitle>
        <View className="mt-8 w-full gap-2">
          <PrimaryButton title="Ver cotización" onPress={() => router.replace(`/order/${order.id}`)} />
          <PrimaryButton title="Seguir comprando" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  if (status === "quote_sent") {
    return (
      <Shell>
        <Badge color="coral" icon="close" />
        <Title>El pago no se completó</Title>
        <Subtitle>No se realizó ningún cargo. Tu cotización sigue vigente, puedes reintentar el pago.</Subtitle>
        <View className="mt-8 w-full gap-2">
          <PrimaryButton title="Ver cotización" onPress={() => router.replace(`/order/${order.id}`)} />
          <PrimaryButton title="Volver al inicio" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  if (status === "cancelled") {
    return (
      <Shell>
        <Badge color="coral" icon="close" />
        <Title>Cotización cancelada</Title>
        <Subtitle>{order.admin_note ?? "Esta cotización ya no está activa."}</Subtitle>
        <View className="mt-8 w-full">
          <PrimaryButton title="Volver al inicio" onPress={() => router.replace("/")} />
        </View>
      </Shell>
    );
  }

  // paid (or any fulfilled state)
  return (
    <Shell>
      <Badge color="primary" icon="checkmark" />
      <Title>¡Pedido confirmado! 🎉</Title>
      <Subtitle>Tu pedido llegará {order.delivery_slot.toLowerCase()}.</Subtitle>
      <View className="mt-8 w-full gap-2">
        <PrimaryButton title="Ver mi pedido" onPress={() => router.replace(`/order/${order.id}`)} />
        <PrimaryButton title="Seguir comprando" onPress={() => router.replace("/")} />
      </View>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-mist px-8">{children}</SafeAreaView>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mt-6 text-center font-quicksand-bold text-2xl text-dark-100">{children}</Text>
  );
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mt-2 text-center font-quicksand-medium text-dark-100/60">{children}</Text>
  );
}

function Badge({ color, icon }: { color: "primary" | "coral"; icon: "checkmark" | "close" | "paper-plane" }) {
  const bg = color === "primary" ? "bg-primary/15" : "bg-coral/15";
  const tint = color === "primary" ? "#3E8368" : "#FF6B4A";
  return (
    <View className={`size-20 items-center justify-center rounded-full ${bg}`}>
      <Ionicons name={icon} size={40} color={tint} />
    </View>
  );
}
```

Add `import type React from "react";` at the top if `React.ReactNode` is not resolved (Expo's JSX runtime does not auto-import the namespace).

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx expo lint`
Expected: only `app/(protected)/(tabs)/orders.tsx` still errors (fixed next task).

- [ ] **Step 4: Manual check**

Run the app (`npx expo start`), sign in as a customer, add items, open checkout: title "Solicitar cotización", button "Solicitar cotización · $X". Tap it → cart empties, result screen shows "¡Cotización enviada!", "Ver cotización" navigates to `/order/<id>` (screen updated in Task 13; for now it renders the old layout with label "Nueva cotización").

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/checkout/index.tsx" "app/(protected)/checkout/result.tsx"
git commit -m "Checkout requests a cotización; result screen handles quote states"
```

---

### Task 12: Pedidos tab — Cotizaciones | Pedidos filter, role-aware list

**Files:**
- Modify: `app/(protected)/(tabs)/orders.tsx`

**Interfaces:**
- Consumes: `useIsAdmin` (existing), `useOrders(kind)`, `useAdminOrders(kind)`, `OrderCard`.
- Produces: routes `/order/[id]` (customer) and `/admin/order/[id]` (admin, created in Task 14).

- [ ] **Step 1: Rewrite the tab**

```tsx
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIsAdmin } from "@/controllers/useAdmin";
import { useAdminOrders } from "@/controllers/useAdminOrders";
import { useOrders } from "@/controllers/useOrders";
import type { Order, OrderKind } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { OrderCard } from "@/views/OrderCard";

const FILTERS: { kind: OrderKind; label: string }[] = [
  { kind: "quotes", label: "Cotizaciones" },
  { kind: "orders", label: "Pedidos" },
];

/**
 * VIEW — Pedidos tab. Customers see their own rows; admins see everyone's.
 * The Cotizaciones | Pedidos filter is the same for both roles.
 */
export default function Orders() {
  const [kind, setKind] = useState<OrderKind>("quotes");
  const { data: isAdmin } = useIsAdmin();
  return isAdmin ? (
    <OrdersScreen kind={kind} onKind={setKind} admin />
  ) : (
    <OrdersScreen kind={kind} onKind={setKind} />
  );
}

function OrdersScreen({
  kind,
  onKind,
  admin = false,
}: {
  kind: OrderKind;
  onKind: (k: OrderKind) => void;
  admin?: boolean;
}) {
  // Both hooks are always called (rules of hooks); the flag disables the
  // query that doesn't apply to this role so only one request is made.
  const customer = useOrders(kind, !admin);
  const adminList = useAdminOrders(kind, undefined, admin);
  const query = admin ? adminList : customer;
  const rows: Order[] = query.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <Text className="px-5 pt-4 font-quicksand-bold text-2xl text-dark-100">
        {admin ? "Pedidos" : "Mis pedidos"}
      </Text>

      <View className="flex-row px-5 pb-1 pt-3">
        {FILTERS.map((f) => {
          const active = f.kind === kind;
          return (
            <Pressable key={f.kind} onPress={() => onKind(f.kind)} className={active ? "chip-active" : "chip"}>
              <Text className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3E8368" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 py-4"
          refreshing={query.isRefetching}
          onRefresh={query.refetch}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              showCustomer={admin}
              onPress={() => router.push(admin ? `/admin/order/${item.id}` : `/order/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            kind === "quotes" ? (
              <EmptyState
                icon="document-text-outline"
                title={admin ? "Sin cotizaciones" : "Aún no tienes cotizaciones"}
                subtitle={admin ? "Las solicitudes nuevas aparecerán aquí" : "Confirma tu carrito para solicitar una"}
              />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title={admin ? "Sin pedidos" : "Aún no tienes pedidos"}
                subtitle="Los pedidos pagados aparecen aquí"
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
```

The `enabled` parameters of `useOrders` and `useAdminOrders` were defined in Task 9; nothing to change in the controllers here.

- [ ] **Step 2: Typecheck, lint, run**

Run: `npx tsc --noEmit && npx expo lint`
Expected: clean except a typed-route complaint about `/admin/order/${id}` until Task 14 adds the route (the dev server regenerates `.expo/types/router.d.ts`). If it blocks, temporarily cast: `router.push((admin ? \`/admin/order/${item.id}\` : \`/order/${item.id}\`) as never)` and remove the cast in Task 14.

Manual: as a customer the Cotizaciones filter shows the Task 11 request with the "Nueva cotización" badge and a citrus border; Pedidos is empty. As an admin (insert your user into `admin_users`) the title is "Pedidos" and every customer's rows appear with names.

- [ ] **Step 3: Commit**

```bash
git add "app/(protected)/(tabs)/orders.tsx"
git commit -m "Pedidos tab: Cotizaciones | Pedidos filter, admin sees all customers"
```

---

### Task 13: Customer order detail — quote state, note, Pagar / Cancelar

**Files:**
- Modify: `app/(protected)/order/[id].tsx`

**Interfaces:**
- Consumes: `useOrder`, `usePayQuote`, `useCancelQuote`, `OrderTotals`, `canPay`, `canCancelQuote`, `isQuote`.

- [ ] **Step 1: Rewrite the screen**

```tsx
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrder } from "@/controllers/useOrders";
import { useCancelQuote, usePayQuote } from "@/controllers/useQuote";
import { canCancelQuote, canPay, isQuote, STATUS_LABELS, STATUS_STYLES } from "@/models/orderStatus";
import { formatDate, formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { ScreenHeader } from "@/views/ScreenHeader";

/** VIEW — customer order/cotización detail: items, address, totals, live status, pay/cancel. */
export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const pay = usePayQuote();
  const cancel = useCancelQuote();

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }

  const [badgeBg, badgeText] = STATUS_STYLES[order.status];
  const kindLabel = isQuote(order) ? "Cotización" : "Pedido";

  const confirmCancel = () =>
    Alert.alert("Cancelar cotización", "¿Seguro que quieres cancelarla?", [
      { text: "No", style: "cancel" },
      { text: "Sí, cancelar", style: "destructive", onPress: () => cancel.mutate(order.id) },
    ]);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title={`${kindLabel} #${order.id.slice(0, 8)}`} />
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              {formatDate(order.created_at)}
            </Text>
            <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
              <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
                {STATUS_LABELS[order.status]}
              </Text>
            </View>
          </View>
          <Text className="mt-2 font-quicksand-bold text-dark-100">{order.delivery_slot}</Text>
          <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
            {order.delivery_address}
          </Text>
        </View>

        {order.status === "quote_requested" ? (
          <Text className="mt-3 px-1 font-quicksand-medium text-sm text-dark-100/60">
            Un asesor está revisando tu cotización. Te avisaremos cuando esté lista para pagar.
          </Text>
        ) : null}

        {order.admin_note ? (
          <View className="mt-4 rounded-2xl bg-foam p-4">
            <Text className="font-quicksand-bold text-sm text-primary">Nota del asesor</Text>
            <Text className="mt-1 font-quicksand-medium text-sm text-dark-100">{order.admin_note}</Text>
          </View>
        ) : null}

        <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">Productos</Text>
        <View className="rounded-2xl bg-white p-4">
          {order.order_items.map((item) => (
            <View key={item.id} className="mb-2 flex-row justify-between">
              <Text numberOfLines={1} className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/80">
                {item.quantity}× {item.name}
              </Text>
              <Text className="font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.unit_price_cents * item.quantity)}
              </Text>
            </View>
          ))}
          <OrderTotals
            subtotal={order.subtotal_cents}
            discount={order.discount_cents}
            discountPercent={order.discount_percent}
            deliveryFee={order.delivery_fee_cents}
            total={order.total_cents}
          />
        </View>
      </ScrollView>

      {canPay(order.status) || canCancelQuote(order.status) ? (
        <View className="gap-2 border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          {canPay(order.status) ? (
            <PrimaryButton
              title={`Pagar ${formatMXN(order.total_cents)} con Mercado Pago`}
              onPress={() => pay.mutate(order.id)}
              loading={pay.isPending}
            />
          ) : null}
          {canCancelQuote(order.status) ? (
            <Pressable onPress={confirmCancel} disabled={cancel.isPending} className="items-center py-2">
              <Text className="font-quicksand-bold text-sm text-coral">
                {cancel.isPending ? "Cancelando…" : "Cancelar cotización"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck, lint, manual**

Run: `npx tsc --noEmit && npx expo lint` → clean.
Manual: open the Task 11 quote → header "Cotización #…", status "Nueva cotización", "Cancelar cotización" visible, no Pagar. Set the row to `quote_sent` in SQL (or wait for Task 14) → within 15s "Pagar … con Mercado Pago" appears. Cancel a fresh quote → status badge "Cancelado", buttons gone.

- [ ] **Step 3: Commit**

```bash
git add "app/(protected)/order/[id].tsx"
git commit -m "Customer order detail: quote states, admin note, pay and cancel actions"
```

---

### Task 14: `QuoteEditor` view

**Files:**
- Create: `views/QuoteEditor.tsx`

**Interfaces:**
- Consumes: Task 7 `computeTotals`, `DiscountInput`, `OrderItem`; `parseMXNInput`, `centsToInput`; `OrderTotals`.
- Produces:
  ```ts
  export interface QuoteDraft {
    items: { id: string; name: string; catalog_price_cents: number; quantity: number; unit_price_cents: number }[];
    deliveryFeeCents: number;
    discount: DiscountInput;
    adminNote: string;
  }
  export function draftFromOrder(order: OrderWithItems): QuoteDraft
  export function draftToInput(draft: QuoteDraft): QuoteEditInput
  export function QuoteEditor({ draft, onChange }: { draft: QuoteDraft; onChange: (d: QuoteDraft) => void })
  ```

- [ ] **Step 1: Write the view**

```tsx
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { computeTotals } from "@/models/orderStatus";
import type { DiscountInput, OrderWithItems, QuoteEditInput } from "@/models/types";
import { centsToInput, formatMXN, parseMXNInput } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";

export interface QuoteDraft {
  items: {
    id: string;
    name: string;
    catalog_price_cents: number;
    quantity: number;
    unit_price_cents: number;
  }[];
  deliveryFeeCents: number;
  discount: DiscountInput;
  adminNote: string;
}

/** Editable copy of an order for the admin editor. */
export function draftFromOrder(order: OrderWithItems): QuoteDraft {
  return {
    items: order.order_items.map((i) => ({
      id: i.id,
      name: i.name,
      catalog_price_cents: i.catalog_price_cents,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
    })),
    deliveryFeeCents: order.delivery_fee_cents,
    discount:
      order.discount_percent != null
        ? { type: "percent", value: order.discount_percent }
        : { type: "amount", cents: order.discount_cents },
    adminNote: order.admin_note ?? "",
  };
}

/** The PATCH body the admin-orders function expects. */
export function draftToInput(draft: QuoteDraft): QuoteEditInput {
  return {
    items: draft.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
    })),
    delivery_fee_cents: draft.deliveryFeeCents,
    discount: draft.discount,
    admin_note: draft.adminNote.trim() || null,
  };
}

interface Props {
  draft: QuoteDraft;
  onChange: (draft: QuoteDraft) => void;
}

/**
 * VIEW — controlled editor for an unpaid cotización: per-line quantity and
 * unit price (catalog price shown as a hint), remove line, delivery fee,
 * discount ($ or %), note, and live totals from the shared money rule.
 */
export function QuoteEditor({ draft, onChange }: Props) {
  const totals = computeTotals({
    items: draft.items,
    discount: draft.discount,
    deliveryFeeCents: draft.deliveryFeeCents,
  });

  const updateItem = (id: string, patch: Partial<QuoteDraft["items"][number]>) =>
    onChange({
      ...draft,
      items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  const removeItem = (id: string) =>
    onChange({ ...draft, items: draft.items.filter((i) => i.id !== id) });

  return (
    <View>
      <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Productos</Text>
      <View className="rounded-2xl bg-white p-4">
        {draft.items.map((item) => (
          <View key={item.id} className="mb-3 border-b border-dark-100/5 pb-3">
            <View className="flex-row items-start justify-between">
              <Text className="flex-1 pr-3 font-quicksand-bold text-sm text-dark-100">{item.name}</Text>
              <Pressable
                onPress={() => removeItem(item.id)}
                disabled={draft.items.length === 1}
                hitSlop={8}
                className={draft.items.length === 1 ? "opacity-30" : ""}
              >
                <Ionicons name="trash-outline" size={18} color="#FF6B4A" />
              </Pressable>
            </View>
            <View className="mt-2 flex-row items-center gap-3">
              <Stepper
                value={item.quantity}
                onChange={(q) => updateItem(item.id, { quantity: q })}
              />
              <View className="flex-1">
                <MoneyInput
                  cents={item.unit_price_cents}
                  onChange={(c) => updateItem(item.id, { unit_price_cents: c })}
                />
                <Text className="mt-0.5 font-quicksand-medium text-[11px] text-dark-100/50">
                  Catálogo: {formatMXN(item.catalog_price_cents)}
                </Text>
              </View>
              <Text className="min-w-[72px] text-right font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.quantity * item.unit_price_cents)}
              </Text>
            </View>
          </View>
        ))}

        <Text className="label mb-1">Envío</Text>
        <MoneyInput
          cents={draft.deliveryFeeCents}
          onChange={(c) => onChange({ ...draft, deliveryFeeCents: c })}
        />

        <Text className="label mb-1 mt-3">Descuento</Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            {draft.discount.type === "amount" ? (
              <MoneyInput
                cents={draft.discount.cents}
                onChange={(c) => onChange({ ...draft, discount: { type: "amount", cents: c } })}
              />
            ) : (
              <TextInput
                value={String(draft.discount.value)}
                keyboardType="number-pad"
                onChangeText={(t) => {
                  const v = Math.min(100, Math.max(0, Number(t.replace(/[^0-9]/g, "")) || 0));
                  onChange({ ...draft, discount: { type: "percent", value: v } });
                }}
                className="input"
              />
            )}
          </View>
          <View className="flex-row rounded-full bg-foam p-0.5">
            {(["amount", "percent"] as const).map((type) => {
              const active = draft.discount.type === type;
              return (
                <Pressable
                  key={type}
                  onPress={() =>
                    onChange({
                      ...draft,
                      discount: type === "amount" ? { type, cents: 0 } : { type, value: 0 },
                    })
                  }
                  className={`rounded-full px-3 py-1.5 ${active ? "bg-primary" : ""}`}
                >
                  <Text className={`font-quicksand-bold text-sm ${active ? "text-white" : "text-dark-100"}`}>
                    {type === "amount" ? "$" : "%"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text className="label mb-1 mt-3">Nota para el cliente</Text>
        <TextInput
          value={draft.adminNote}
          onChangeText={(t) => onChange({ ...draft, adminNote: t })}
          placeholder="Opcional"
          placeholderTextColor="rgba(16,36,31,0.35)"
          multiline
          className="input min-h-[64px]"
        />

        <OrderTotals
          subtotal={totals.subtotal}
          discount={totals.discount}
          discountPercent={draft.discount.type === "percent" ? draft.discount.value : null}
          deliveryFee={totals.deliveryFee}
          total={totals.total}
        />
      </View>
    </View>
  );
}

/** Local +/− control (the cart's QuantityStepper is bound to the cart store). */
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full bg-foam px-1 py-0.5">
      <Pressable
        onPress={() => onChange(Math.max(1, value - 1))}
        className="size-8 items-center justify-center rounded-full bg-white"
        hitSlop={6}
      >
        <Ionicons name="remove" size={16} color="#10241F" />
      </Pressable>
      <Text className="min-w-5 text-center font-quicksand-bold text-sm text-dark-100">{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(99, value + 1))}
        className="size-8 items-center justify-center rounded-full bg-primary"
        hitSlop={6}
      >
        <Ionicons name="add" size={16} color="white" />
      </Pressable>
    </View>
  );
}

/**
 * Pesos text input that reports integer cents. Keeps its own text while
 * focused so "12." and "12.5" can be typed; commits on every valid parse.
 */
function MoneyInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(centsToInput(cents));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : centsToInput(cents);
  return (
    <TextInput
      value={shown}
      keyboardType="decimal-pad"
      onFocus={() => {
        setText(centsToInput(cents));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChangeText={(t) => {
        setText(t);
        const parsed = parseMXNInput(t);
        if (parsed !== null) onChange(parsed);
      }}
      className="input"
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add views/QuoteEditor.tsx
git commit -m "Add QuoteEditor view: editable lines, fee, discount, note with live totals"
```

---

### Task 15: Admin order detail screen (edit / send / reject / advance / PDF)

**Files:**
- Create: `app/(protected)/admin/order/[id].tsx`
- Modify: `app/(protected)/(tabs)/orders.tsx` (remove the `as never` cast if it was added in Task 12)

**Interfaces:**
- Consumes: `useOrder`, `useUpdateQuote`, `useSendQuote`, `useRejectQuote`, `useAdvanceOrder`, `useQuotePdf`, `QuoteEditor` + `draftFromOrder` + `draftToInput`, `OrderTotals`, `isQuoteEditable`, `nextFulfillmentStatus`, `FULFILLMENT_LABELS`.

- [ ] **Step 1: Write the screen**

```tsx
// VIEW — admin detail of a cotización/pedido. The admin guard lives in
// app/(protected)/admin/_layout.tsx. Quotes are edited with QuoteEditor and
// saved through the admin-orders function; pedidos are read-only except for
// advancing the fulfillment status. Both can be exported as PDF.
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  useAdvanceOrder,
  useRejectQuote,
  useSendQuote,
  useUpdateQuote,
} from "@/controllers/useAdminOrders";
import { useOrder } from "@/controllers/useOrders";
import { useQuotePdf } from "@/controllers/useQuotePdf";
import {
  FULFILLMENT_LABELS,
  isQuote,
  isQuoteEditable,
  nextFulfillmentStatus,
  STATUS_LABELS,
  STATUS_STYLES,
} from "@/models/orderStatus";
import type { OrderWithItems } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { draftFromOrder, draftToInput, QuoteEditor, type QuoteDraft } from "@/views/QuoteEditor";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function AdminOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }
  return <Loaded order={order} />;
}

function Loaded({ order }: { order: OrderWithItems }) {
  const update = useUpdateQuote();
  const send = useSendQuote();
  const reject = useRejectQuote();
  const advance = useAdvanceOrder();
  const pdf = useQuotePdf();

  const editable = isQuoteEditable(order.status);
  const [draft, setDraft] = useState<QuoteDraft>(() => draftFromOrder(order));
  const [dirty, setDirty] = useState(false);

  // Resync the draft when the server row changes and the admin isn't mid-edit
  // (e.g. after a save, or when another admin edited it).
  useEffect(() => {
    if (!dirty) setDraft(draftFromOrder(order));
  }, [order, dirty]);

  const onDraftChange = (d: QuoteDraft) => {
    setDraft(d);
    setDirty(true);
  };

  const save = async () => {
    await update.mutateAsync({ id: order.id, input: draftToInput(draft) });
    setDirty(false);
  };

  const sendQuote = async () => {
    try {
      if (dirty) await save();
      await send.mutateAsync(order.id);
      Alert.alert("Cotización enviada", "El cliente ya puede verla y pagarla.");
    } catch {
      // The mutation hooks already alerted.
    }
  };

  const rejectQuote = () =>
    Alert.prompt?.(
      "Rechazar cotización",
      "Motivo (opcional, lo verá el cliente)",
      (note) => reject.mutate({ id: order.id, note }),
      "plain-text"
    ) ??
    Alert.alert("Rechazar cotización", "¿Rechazar esta cotización?", [
      { text: "No", style: "cancel" },
      { text: "Rechazar", style: "destructive", onPress: () => reject.mutate({ id: order.id }) },
    ]);

  const next = nextFulfillmentStatus(order.status);
  const [badgeBg, badgeText] = STATUS_STYLES[order.status];
  const busy = update.isPending || send.isPending || reject.isPending || advance.isPending;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <View className="flex-row items-center pr-5">
        <View className="flex-1">
          <ScreenHeader title={`${isQuote(order) ? "Cotización" : "Pedido"} #${order.id.slice(0, 8)}`} />
        </View>
        <Pressable
          onPress={() => pdf.download(order)}
          disabled={pdf.generating}
          className="h-10 flex-row items-center gap-1.5 rounded-full bg-white px-3"
        >
          {pdf.generating ? (
            <ActivityIndicator size="small" color="#3E8368" />
          ) : (
            <Ionicons name="download-outline" size={16} color="#3E8368" />
          )}
          <Text className="font-quicksand-semibold text-sm text-dark-100">PDF</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
        <View className="rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              {formatDate(order.created_at)}
            </Text>
            <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
              <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
                {STATUS_LABELS[order.status]}
              </Text>
            </View>
          </View>
          <Text className="mt-3 font-quicksand-bold text-dark-100">
            {order.customer_name || "Cliente"}
          </Text>
          <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.customer_email}</Text>
          {order.customer_phone ? (
            <Text className="font-quicksand-medium text-sm text-dark-100/60">{order.customer_phone}</Text>
          ) : null}
          <Text className="mt-3 font-quicksand-bold text-dark-100">{order.delivery_slot}</Text>
          <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
            {order.delivery_address}
          </Text>
        </View>

        <View className="mt-6">
          {editable ? (
            <QuoteEditor draft={draft} onChange={onDraftChange} />
          ) : (
            <>
              <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Productos</Text>
              <View className="rounded-2xl bg-white p-4">
                {order.order_items.map((item) => (
                  <View key={item.id} className="mb-2 flex-row justify-between">
                    <Text numberOfLines={1} className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/80">
                      {item.quantity}× {item.name}
                    </Text>
                    <Text className="font-quicksand-semibold text-sm text-dark-100">
                      {formatMXN(item.unit_price_cents * item.quantity)}
                    </Text>
                  </View>
                ))}
                <OrderTotals
                  subtotal={order.subtotal_cents}
                  discount={order.discount_cents}
                  discountPercent={order.discount_percent}
                  deliveryFee={order.delivery_fee_cents}
                  total={order.total_cents}
                />
              </View>
              {order.admin_note ? (
                <View className="mt-4 rounded-2xl bg-foam p-4">
                  <Text className="font-quicksand-bold text-sm text-primary">Nota</Text>
                  <Text className="mt-1 font-quicksand-medium text-sm text-dark-100">{order.admin_note}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>

      {editable ? (
        <View className="gap-2 border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          <PrimaryButton
            title={order.status === "quote_sent" ? "Reenviar cotización" : "Enviar cotización"}
            onPress={sendQuote}
            loading={send.isPending || (update.isPending && !dirty)}
            disabled={busy || draft.items.length === 0}
          />
          <View className="flex-row justify-between px-1">
            <Pressable onPress={rejectQuote} disabled={busy} className="py-2">
              <Text className="font-quicksand-bold text-sm text-coral">Rechazar</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!dirty || busy} className={`py-2 ${dirty ? "" : "opacity-40"}`}>
              <Text className="font-quicksand-bold text-sm text-primary">
                {update.isPending ? "Guardando…" : "Guardar cambios"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : next ? (
        <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
          <PrimaryButton
            title={`Marcar como ${FULFILLMENT_LABELS[next].toLowerCase()}`}
            onPress={() => advance.mutate({ id: order.id, to: next })}
            loading={advance.isPending}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
```

Note on `Alert.prompt`: it exists on iOS only. The `?.`/`??` chain above calls it when available and falls back to a confirm-only dialog on Android/web. On Android the admin types the reason in "Nota para el cliente", taps Guardar, then Rechazar — Task 5's reject branch preserves the saved note when none is sent.

- [ ] **Step 2: Typed routes, typecheck, lint**

Run `npx expo start` once (regenerates `.expo/types/router.d.ts` with `/admin/order/[id]`), stop it, remove any `as never` cast left in `orders.tsx`, then `npx tsc --noEmit && npx expo lint` → clean.

- [ ] **Step 3: Manual check (admin account)**

1. Pedidos → Cotizaciones → tap the new quote. Editor shows lines with catalog hint.
2. Change a unit price, quantity, set discount 10 %, fee 0, note. Totals update live. Guardar → alert-free, status unchanged, values persist after pull-to-refresh.
3. PDF → share sheet opens with a PDF showing the edited values and the discount row.
4. Enviar cotización → alert "Cotización enviada"; badge "Cotización enviada"; customer email received.
5. Rechazar on another quote → badge "Cancelado"; customer sees the note.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/admin/order/[id].tsx" "app/(protected)/(tabs)/orders.tsx"
git commit -m "Add admin order detail: edit, send, reject, advance and PDF export"
```

---

### Task 16: Docs — CLAUDE.md, `.env.example`, delivery comment

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`

- [ ] **Step 1: `.env.example`** — append to the secrets section:

```
# supabase secrets set RESEND_API_KEY=re_...             (Resend API key for quote emails; optional — emails are skipped without it)
# supabase secrets set QUOTES_FROM_EMAIL="LimpiezaApp <cotizaciones@tu-dominio.com>"
```

- [ ] **Step 2: `CLAUDE.md`** edits:

1. **Project** paragraph: replace "and Mercado Pago Checkout Pro" with "and a quote-first checkout (cotizaciones) paid through Mercado Pago Checkout Pro once an admin sends the quote".
2. **Commands**: replace `npx supabase functions deploy create-order` with three lines: `create-quote`, `quote-actions`, `admin-orders` (all default JWT verification). Keep the `mp-webhook --no-verify-jwt` line.
3. **Architecture → models**: add `quoteModel`, `adminOrderModel`, `quoteDocument` (pure HTML for the PDF), `functionError`; note that `orderStatus.ts` also holds `computeTotals` (the client mirror of `apply_quote_edit`). **controllers**: add `useQuote`, `useAdminOrders`, `useQuotePdf`; `useCheckout` "requests a cotización (no payment)".
4. **Security invariants**: replace the two payment bullets with:
   - "A cotización is an `orders` row with `paid_at IS NULL`. Clients never write `orders`/`order_items`; admins edit unpaid quotes only through `admin-orders` → `apply_quote_edit` (service-role RPC), which recomputes totals and clears any MP preference. `create-quote` recomputes all prices from the DB."
   - "Payment truth comes exclusively from `mp-webhook` (validates `x-signature` timing-safely, re-fetches the payment, idempotent). Only it sets `paid`/`paid_at`; a failed payment returns the row to `quote_sent`. `quote-actions` builds the MP preference from the stored quoted total, never from the client."
5. **Gotchas**: change the delivery-constants bullet to point at `supabase/functions/_shared/delivery.ts`; add: "Postgres cannot use a new enum value inside the migration that adds it — `ALTER TYPE … ADD VALUE` goes in its own migration file (see `20260914120000_quotes_enum.sql`)." and "Edge Function shared code lives in `supabase/functions/_shared/` and is imported with relative `../_shared/x.ts` paths."

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "Document the quote-first checkout, new functions and secrets"
```

---

### Task 17: End-to-end verification (Mercado Pago sandbox)

**Files:** none (verification only; fix anything found and commit per fix).

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit && npx expo lint && npx expo-doctor`
Expected: all clean.

- [ ] **Step 2: Deployed state**

```bash
npx supabase db push          # no pending migrations
npx supabase functions list   # create-quote, quote-actions, admin-orders, mp-webhook, admin-products, admin-categories; NO create-order
```

- [ ] **Step 3: Happy path**

1. Customer: cart → Solicitar cotización → cart empty, "¡Cotización enviada!"; admin email received.
2. Admin: Pedidos → Cotizaciones shows it with "Nueva cotización" + citrus border; edit price/qty/discount/fee, Guardar, PDF opens with the edited totals, Enviar.
3. Customer: email received; detail shows "Cotización enviada", the note, and "Pagar … con Mercado Pago"; tap → MP sandbox → approve → back in app "Confirmando tu pago…" → "¡Pedido confirmado!" within ~10s.
4. Both roles: row moved from Cotizaciones to Pedidos with status "Pagado"; `products.stock` decreased by the quoted quantities; `orders.paid_at` set.
5. Admin: Marcar como preparando → en camino → entregado; the button disappears at Entregado.

- [ ] **Step 4: Negative paths**

1. Pay with a rejected sandbox card → result screen "El pago no se completó"; row back to "Cotización enviada" with `mp_preference_id` null; Pagar works again.
2. Close the MP browser without paying → detail still shows Pagar; tapping it reopens the same preference (server returns stored `mp_init_point`).
3. Customer cancels a `quote_requested` quote → "Cancelado", no buttons; admin sees it under Cotizaciones.
4. Admin rejects with a note → customer sees the note card.
5. Admin opens a paid pedido → no editor, only Marcar como… and PDF. `PATCH` via curl on a paid id → `409 "La cotización ya no se puede editar"`.
6. A non-admin calling `admin-orders` via curl → `403`; a customer calling `quote-actions` with another user's order id → `404`.

- [ ] **Step 5: Final commit / branch state**

`git status` clean, all tasks committed on `feature/limpiezaapp-production`.

---

## Self-review notes

- **Spec coverage**: migration (T1), shared helpers + email (T2), create-quote (T3), quote-actions (T4), admin-orders (T5), webhook (T6), types/predicates/computeTotals/parseMXNInput (T7), models incl. `functionError` and `quoteDocument` (T8), controllers incl. `useQuotePdf` and deps (T9), `OrderTotals`/`OrderCard` (T10), checkout + result (T11), Pedidos tab filter (T12), customer detail (T13), `QuoteEditor` (T14), admin detail (T15), docs (T16), verification (T17). Search on the admin list is supported server-side but has no UI on purpose (not in spec's screens).
- **Type consistency**: `QuoteEditInput`, `DiscountInput`, `FulfillmentStatus`, `OrderKind` are defined in T7 and used verbatim in T5 (mirrored in zod), T8, T9, T14, T15. `useOrders(kind, enabled)` / `useAdminOrders(kind, search, enabled)` signatures are the T12 versions. `useCheckout` returns `{ requestQuote, submitting }` (T9) and T11 consumes exactly that.
- **Known trade-off**: `Alert.prompt` is iOS-only; Android admins leave the rejection reason via the note field + Guardar before Rechazar (T15 adjusts the reject branch so an omitted note preserves the saved one).
