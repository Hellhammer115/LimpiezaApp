# Admin-Created Cotizaciones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin builds a cart, picks a registered customer by email or phone, adjusts prices/fee/discount/note in the editor and sends the quote; the customer accepts it (address + slot, then pay) or rejects it.

**Architecture:** Admin-created quotes are ordinary `orders` rows tagged with a new `created_by_admin` column; address and slot stay empty (`''`, `address_id` null) until the customer accepts. Two new server actions (`admin-orders` `create`, `quote-actions` `accept`) plus a tiny `admin-users` lookup function. The app adds one admin screen (recipient search + the existing `QuoteEditor`), one customer screen (address/slot + "Aceptar y pagar"), and small conditionals in the existing detail/list views.

**Tech Stack:** Expo SDK 57 + React Native + expo-router + NativeWind, Supabase (Postgres/Edge Functions in Deno via the Supabase MCP), TanStack Query v5, zod.

**Spec:** `docs/superpowers/specs/2026-09-16-admin-created-quotes-design.md`

## Global Constraints

- `orders`/`order_items` keep zero client write policies; every write goes through an Edge Function. Admin edits and admin creation compute totals only through `apply_quote_edit`. (Spec → Data model, admin-orders)
- `needsAcceptance(order) = order.created_by_admin != null && order.address_id == null`; while true, `delivery_address` and `delivery_slot` are `''`. (Spec → Data model)
- `pay` must refuse an order whose `address_id` is null with 409 "Elige una dirección y horario antes de pagar". (Spec → quote-actions)
- Recipient lookup: admin-only, `q` trimmed, min 3 chars, `%,()` stripped, max 10 results, never addresses. (Spec → admin-users)
- Money is integer cents; all user-facing errors are Spanish; email is best effort.
- MVC: views → controllers → models; only models import `@/services/supabase`. `supabase/functions/**` is Deno; deploy through the Supabase MCP bundling the `_shared/*.ts` files each function imports.
- The Supabase CLI is not linked: apply migrations with `mcp__supabase__apply_migration`, then rename the repo file to the version `list_migrations` reports.
- Lint rule `react-hooks/set-state-in-effect` fails `npx expo lint`: derive state, never sync it in an effect. `URLSearchParams.size` is unavailable (polyfill): use `toString()`.
- Typed routes regenerate only while the dev server runs (`npx expo start --offline --port 8089` for ~110s, then confirm the port is free).
- No automated tests exist; each task verifies with `npx tsc --noEmit` (exit 0, no output) and `npx expo lint` (clean). Manual checks are marked as such.
- Commit after each task; append the two trailer lines from `.superpowers/sdd/<plan>/commit-trailer.txt` if present, else the session's standard trailer.

---

### Task 1: Migration — `orders.created_by_admin`

**Files:**
- Create: `supabase/migrations/<version>_admin_created_quotes.sql`

**Interfaces:**
- Produces: `orders.created_by_admin uuid null` (FK `auth.users`, set null on delete).

- [ ] **Step 1: Apply through the MCP**

Call `mcp__supabase__apply_migration` with name `admin_created_quotes` and:

```sql
-- Admin-created cotizaciones: who sent it. While address_id is null on such a
-- row, delivery_address/delivery_slot are '' and the customer must accept
-- (choose address + slot) before paying.
alter table public.orders
  add column created_by_admin uuid references auth.users (id) on delete set null;
```

- [ ] **Step 2: Write the repo file with the recorded version**

Call `mcp__supabase__list_migrations`; write the same SQL to `supabase/migrations/<version>_admin_created_quotes.sql` where `<version>` is the 14-digit value recorded for `admin_created_quotes`.

- [ ] **Step 3: Verify**

`mcp__supabase__execute_sql`: `select column_name from information_schema.columns where table_name='orders' and column_name='created_by_admin';` → 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_admin_created_quotes.sql
git commit -m "Add orders.created_by_admin for admin-created cotizaciones"
```

---

### Task 2: `admin-users` Edge Function (recipient lookup)

**Files:**
- Create: `supabase/functions/admin-users/index.ts`
- Modify: `supabase/config.toml` (add `[functions.admin-users] verify_jwt = true`)

**Interfaces:**
- Consumes: `_shared/auth.ts` (`getCaller`, `requireAdmin`), `_shared/http.ts` (`json`).
- Produces: `GET admin-users?q=<text>` → `200 CustomerMatch[]` where `CustomerMatch = { user_id: string; name: string; last_name: string; email: string; phone: string | null }`; `400 { error: "Escribe al menos 3 caracteres" }`; `401`; `403`.

- [ ] **Step 1: Write the function**

```ts
// admin-users: recipient lookup for admin-created cotizaciones. Admin-gated;
// searches profiles by email or phone with the service role and never
// returns addresses. Deployed with verify_jwt = true.
import { getCaller, requireAdmin } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { admin, user } = caller;
    if (!(await requireAdmin(admin, user.id))) return json({ error: "Prohibido" }, 403);

    // Strip PostgREST filter syntax characters before interpolating.
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%,()]/g, "");
    if (q.length < 3) return json({ error: "Escribe al menos 3 caracteres" }, 400);

    const { data, error } = await admin
      .from("profiles")
      .select("user_id, name, last_name, email, phone")
      .or(`email.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("email")
      .limit(10);
    if (error) throw error;
    return json(data);
  } catch (error) {
    console.error("admin-users failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
```

- [ ] **Step 2: config.toml**

Append:

```toml

[functions.admin-users]
verify_jwt = true
```

- [ ] **Step 3: Deploy and smoke test**

`mcp__supabase__deploy_edge_function`: name `admin-users`, `verify_jwt: true`, entrypoint `admin-users/index.ts`, files: `admin-users/index.ts`, `_shared/http.ts`, `_shared/auth.ts` (exact on-disk contents). Then `curl -i "<project_url>/functions/v1/admin-users?q=abc"` without headers → 401.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin-users supabase/config.toml
git commit -m "Add admin-users Edge Function: recipient lookup by email or phone"
```

---

### Task 3: `admin-orders` — `create` action

**Files:**
- Modify: `supabase/functions/admin-orders/index.ts`

**Interfaces:**
- Consumes: `apply_quote_edit` RPC; `_shared/delivery.ts` (`deliveryFeeCents`); `_shared/email.ts`.
- Produces: `POST admin-orders { action: "create", userId, items: [{ productId, quantity, unit_price_cents }], delivery_fee_cents, discount, admin_note }` → `200 OrderWithItems`; `404 { error: "Cliente no encontrado" }`; `409 { error }` (product inactive/stock/RPC message).

- [ ] **Step 1: Imports and schema**

Add `import { deliveryFeeCents } from "../_shared/delivery.ts";` next to the other `_shared` imports. Add a `discountSchema` and a `createSchema`, and register `create` in `actionSchema`:

```ts
const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("amount"), cents: z.number().int().min(0) }),
  z.object({ type: z.literal("percent"), value: z.number().int().min(0).max(100) }),
]);

const createSchema = z.object({
  id: z.string().uuid().optional(), // unused; keeps the discriminated union shape uniform
  action: z.literal("create"),
  userId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        unit_price_cents: z.number().int().min(0),
      })
    )
    .min(1)
    .max(50),
  delivery_fee_cents: z.number().int().min(0),
  discount: discountSchema,
  admin_note: z.string().max(1000).nullable(),
});
```

Replace the inline discount union inside `patchSchema` with `discount: discountSchema,` and add `createSchema,` as the first member of `actionSchema`'s array.

- [ ] **Step 2: The branch** — insert at the top of the `req.method === "POST"` block, right after `const now = …`:

```ts
      if (body.action === "create") {
        const productIds = body.items.map((i) => i.productId);
        if (new Set(productIds).size !== productIds.length) {
          return json({ error: "Producto repetido en la cotización" }, 409);
        }
        const [profileResult, productsResult] = await Promise.all([
          admin
            .from("profiles")
            .select("user_id, name, last_name, phone, email")
            .eq("user_id", body.userId)
            .maybeSingle(),
          admin
            .from("products")
            .select("id, name, price_cents, stock, is_active")
            .in("id", productIds),
        ]);
        const profile = profileResult.data;
        if (!profile) return json({ error: "Cliente no encontrado" }, 404);
        if (productsResult.error) throw productsResult.error;

        let subtotalCents = 0;
        const rows: {
          product_id: string;
          name: string;
          quantity: number;
          unit_price_cents: number;
          catalog_price_cents: number;
        }[] = [];
        for (const item of body.items) {
          const product = productsResult.data?.find((p) => p.id === item.productId);
          if (!product || !product.is_active) {
            return json({ error: "Un producto ya no está disponible" }, 409);
          }
          if (product.stock < item.quantity) {
            return json({ error: `Sin existencias: ${product.name}` }, 409);
          }
          subtotalCents += product.price_cents * item.quantity;
          rows.push({
            product_id: product.id,
            name: product.name,
            quantity: item.quantity,
            unit_price_cents: product.price_cents,
            catalog_price_cents: product.price_cents,
          });
        }
        const feeCents = deliveryFeeCents(subtotalCents);
        const customerName = [profile.name, profile.last_name].filter(Boolean).join(" ").trim();

        const { data: order, error: orderError } = await admin
          .from("orders")
          .insert({
            user_id: body.userId,
            address_id: null,
            delivery_address: "",
            delivery_slot: "",
            status: "quote_sent",
            quoted_at: now,
            quoted_by: user.id,
            created_by_admin: user.id,
            subtotal_cents: subtotalCents,
            discount_cents: 0,
            delivery_fee_cents: feeCents,
            total_cents: subtotalCents + feeCents,
            customer_name: customerName,
            customer_phone: profile.phone ?? null,
            customer_email: profile.email ?? "",
          })
          .select("id")
          .single();
        if (orderError) throw orderError;

        const { data: inserted, error: itemsError } = await admin
          .from("order_items")
          .insert(rows.map((r) => ({ ...r, order_id: order.id })))
          .select("id, product_id");
        if (itemsError || !inserted) {
          await admin.from("orders").delete().eq("id", order.id);
          throw itemsError ?? new Error("order_items insert returned nothing");
        }

        // The admin's prices/fee/discount/note go through the same atomic
        // totals RPC the editor uses.
        const byProduct = new Map(body.items.map((i) => [i.productId, i]));
        const { error: editError } = await admin.rpc("apply_quote_edit", {
          p_order_id: order.id,
          p_items: inserted.map((row) => ({
            id: row.id,
            quantity: byProduct.get(row.product_id)!.quantity,
            unit_price_cents: byProduct.get(row.product_id)!.unit_price_cents,
          })),
          p_delivery_fee_cents: body.delivery_fee_cents,
          p_discount_cents: body.discount.type === "amount" ? body.discount.cents : 0,
          p_discount_percent: body.discount.type === "percent" ? body.discount.value : null,
          p_admin_note: body.admin_note,
        });
        if (editError) {
          await admin.from("orders").delete().eq("id", order.id);
          if (editError.code === "P0001" || editError.code === "P0002") {
            return json({ error: editError.message }, 409);
          }
          throw editError;
        }

        if (profile.email) {
          await sendEmail({
            to: [profile.email],
            subject: `Recibiste una cotización de LimpiezaApp (#${order.id.slice(0, 8)})`,
            html: `<p>Hola ${escapeHtml(customerName || "")},</p>
<p>Te enviamos una cotización. Ábrela en LimpiezaApp (Pedidos → Cotizaciones) para aceptarla, elegir tu dirección y pagarla, o rechazarla.</p>`,
          });
        }
        return json(await fetchOrder(order.id));
      }
```

- [ ] **Step 3: Deploy** via the MCP (files: `admin-orders/index.ts`, `_shared/http.ts`, `_shared/auth.ts`, `_shared/email.ts`, `_shared/delivery.ts`). Confirm ACTIVE and a new version.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin-orders/index.ts
git commit -m "admin-orders: create a cotización for a customer with edited prices"
```

---

### Task 4: `quote-actions` — `accept` action and pay guard

**Files:**
- Modify: `supabase/functions/quote-actions/index.ts`

**Interfaces:**
- Produces: `POST { action: "accept", orderId, addressId, deliverySlot }` → `200 { ok: true }`; `400 { error: "Dirección no encontrada" }`; `409 { error: "Esta cotización no requiere aceptación" }`. `pay` → `409 { error: "Elige una dirección y horario antes de pagar" }` when `address_id` is null.

- [ ] **Step 1: Schema** — replace `bodySchema` with:

```ts
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), orderId: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), orderId: z.string().uuid() }),
  z.object({ action: z.literal("delete"), orderId: z.string().uuid() }),
  z.object({
    action: z.literal("accept"),
    orderId: z.string().uuid(),
    addressId: z.string().uuid(),
    deliverySlot: z.string().min(1).max(100),
  }),
]);
```

and change `const { action, orderId } = parsed.data;` to `const body = parsed.data; const { action, orderId } = body;`.

- [ ] **Step 2: Select the acceptance fields** — change the order select to `"id, status, total_cents, address_id, created_by_admin, mp_init_point, order_items ( product_id, name, quantity )"`.

- [ ] **Step 3: Accept branch** — insert after the `delete` branch:

```ts
    if (action === "accept") {
      if (body.action !== "accept") return json({ error: "Solicitud inválida" }, 400);
      if (order.status !== "quote_sent" || !order.created_by_admin || order.address_id) {
        return json({ error: "Esta cotización no requiere aceptación" }, 409);
      }
      const { data: address } = await userClient
        .from("addresses")
        .select("id, label, street, colonia, city, zip")
        .eq("id", body.addressId)
        .maybeSingle();
      if (!address) return json({ error: "Dirección no encontrada" }, 400);
      const deliveryAddress = [
        `${address.label}: ${address.street}`,
        address.colonia,
        `${address.city} ${address.zip}`.trim(),
      ]
        .filter(Boolean)
        .join(", ");
      const { data: accepted, error } = await admin
        .from("orders")
        .update({
          address_id: address.id,
          delivery_address: deliveryAddress,
          delivery_slot: body.deliverySlot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "quote_sent")
        .is("address_id", null)
        .select("id");
      if (error) throw error;
      if (!accepted || accepted.length === 0) {
        return json({ error: "Esta cotización no requiere aceptación" }, 409);
      }
      return json({ ok: true });
    }
```

- [ ] **Step 4: Pay guard** — right after the `// action === "pay"` comment, before the resume check:

```ts
    if (!order.address_id) {
      return json({ error: "Elige una dirección y horario antes de pagar" }, 409);
    }
```

Update the header comment to list `accept — records the address/slot chosen for an admin-created quote.`

- [ ] **Step 5: Deploy** via the MCP (files: `quote-actions/index.ts`, `_shared/http.ts`, `_shared/auth.ts`). Confirm ACTIVE and a new version.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/quote-actions/index.ts
git commit -m "quote-actions: accept an admin-created cotización; pay requires an address"
```

---

### Task 5: App types, predicates, models, controllers

**Files:**
- Modify: `models/types.ts`, `models/orderStatus.ts`, `models/adminModel.ts` (union), `models/adminOrderModel.ts`, `models/quoteModel.ts`, `controllers/useAdminOrders.ts`, `controllers/useQuote.ts`

**Interfaces:**
- Produces: `Order.created_by_admin: string | null`; `CustomerMatch`; `AdminCreateQuoteInput = { userId: string; items: { productId: string; quantity: number; unit_price_cents: number }[]; delivery_fee_cents: number; discount: DiscountInput; admin_note: string | null }`; `needsAcceptance(order)`, `isAdminQuote(order)`; `lookupCustomers(q): Promise<CustomerMatch[]>`, `createQuoteForCustomer(input): Promise<OrderWithItems>`, `acceptQuote(orderId, addressId, deliverySlot): Promise<void>`; hooks `useCustomerLookup(q)`, `useCreateQuoteForCustomer()`, `useAcceptQuote()`.

- [ ] **Step 1: types.ts** — after `hidden_by_admin_at: string | null;` in `Order` add `/** Admin who sent this quote; null for customer-requested ones. */ created_by_admin: string | null;`. Append:

```ts
/** A registered customer as returned by the admin-users lookup. */
export interface CustomerMatch {
  user_id: string;
  name: string;
  last_name: string;
  email: string;
  phone: string | null;
}

/** Body of admin-orders `create` (mirrors its zod schema). */
export interface AdminCreateQuoteInput {
  userId: string;
  items: { productId: string; quantity: number; unit_price_cents: number }[];
  delivery_fee_cents: number;
  discount: DiscountInput;
  admin_note: string | null;
}
```

- [ ] **Step 2: orderStatus.ts** — append:

```ts
/** Sent by an admin (as opposed to requested by the customer). */
export const isAdminQuote = (order: Pick<Order, "created_by_admin">) =>
  order.created_by_admin !== null;

/** Admin-created and the customer has not chosen address/slot yet. */
export const needsAcceptance = (order: Pick<Order, "created_by_admin" | "address_id">) =>
  order.created_by_admin !== null && order.address_id === null;
```

- [ ] **Step 3: adminModel.ts** — widen the union: `"admin-products" | "admin-categories" | "admin-orders" | "admin-users"`.

- [ ] **Step 4: adminOrderModel.ts** — extend the type import with `AdminCreateQuoteInput, CustomerMatch` and append:

```ts
/** Registered customers whose email or phone contains `q` (admin only). */
export async function lookupCustomers(q: string): Promise<CustomerMatch[]> {
  return invokeAdminFunction<CustomerMatch[]>("admin-users", "GET", undefined, { q });
}

/** Creates and sends a cotización to a customer with the admin's prices. */
export async function createQuoteForCustomer(
  input: AdminCreateQuoteInput
): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", {
    action: "create",
    ...input,
  });
}
```

- [ ] **Step 5: quoteModel.ts** — append:

```ts
/** Accepts an admin-created quote by choosing the delivery address and slot. */
export async function acceptQuote(
  orderId: string,
  addressId: string,
  deliverySlot: string
): Promise<void> {
  const { error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "accept", orderId, addressId, deliverySlot },
  });
  if (error) {
    throw new Error(await functionErrorMessage(error, "No se pudo aceptar la cotización."));
  }
}
```

- [ ] **Step 6: useAdminOrders.ts** — import `createQuoteForCustomer, lookupCustomers` and `AdminCreateQuoteInput`; import `useCart` from `@/controllers/useCart`; append:

```ts
/** Customers matching an email/phone fragment; disabled under 3 characters. */
export function useCustomerLookup(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["admin-users", trimmed],
    queryFn: () => lookupCustomers(trimmed),
    enabled: trimmed.length >= 3,
  });
}

/** Sends a quote to a customer, clears the cart and opens the admin detail. */
export function useCreateQuoteForCustomer() {
  const invalidate = useInvalidateAllOrders();
  const clearCart = useCart((s) => s.clear);
  return useMutation({
    mutationFn: (input: AdminCreateQuoteInput) => createQuoteForCustomer(input),
    onSuccess: (order) => {
      clearCart();
      invalidate();
      router.replace(`/admin/order/${order.id}`);
    },
    onError: (error) => Alert.alert("No se envió", error.message),
  });
}
```

- [ ] **Step 7: useQuote.ts** — import `acceptQuote`; append:

```ts
/** Records the customer's address/slot on an admin-created quote. */
export function useAcceptQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ orderId, addressId, deliverySlot }: { orderId: string; addressId: string; deliverySlot: string }) =>
      acceptQuote(orderId, addressId, deliverySlot),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}
```

- [ ] **Step 8:** `npx tsc --noEmit` and `npx expo lint` → clean. Commit:

```bash
git add models/types.ts models/orderStatus.ts models/adminModel.ts models/adminOrderModel.ts models/quoteModel.ts controllers/useAdminOrders.ts controllers/useQuote.ts
git commit -m "Add admin-created quote models, predicates and controllers"
```

---

### Task 6: Admin screen — "Cotizar a un cliente"

**Files:**
- Create: `app/(protected)/admin/quote/new.tsx`
- Modify: `app/(protected)/cart.tsx`

**Interfaces:**
- Consumes: `useCustomerLookup`, `useCreateQuoteForCustomer`, `useCart`, `useIsAdmin`, `QuoteEditor`/`QuoteDraft`, `computeTotals`, `deliveryFeeCents` (models/delivery), `CustomerMatch`.

- [ ] **Step 1: Cart button** — in `cart.tsx` import `useIsAdmin` from `@/controllers/useAdmin`; inside `Cart()` add `const { data: isAdmin } = useIsAdmin();`; below the `Continuar` `PrimaryButton` add:

```tsx
              {isAdmin ? (
                <Pressable
                  onPress={() => router.push("/admin/quote/new")}
                  className="mt-2 items-center py-2"
                >
                  <Text className="font-quicksand-bold text-sm text-primary">
                    Cotizar a un cliente
                  </Text>
                </Pressable>
              ) : null}
```

- [ ] **Step 2: The screen**

```tsx
// VIEW — admin: send a cotización to a registered customer. Recipient search
// (email/phone) + the shared QuoteEditor seeded from the cart. The admin's
// prices go to the server as-is; totals are recomputed there.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCreateQuoteForCustomer, useCustomerLookup } from "@/controllers/useAdminOrders";
import { useCart, useCartSubtotal } from "@/controllers/useCart";
import { deliveryFeeCents } from "@/models/delivery";
import type { CustomerMatch } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { PrimaryButton } from "@/views/PrimaryButton";
import { QuoteEditor, type QuoteDraft } from "@/views/QuoteEditor";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function AdminNewQuote() {
  const items = useCart((s) => s.items);
  const subtotal = useCartSubtotal();
  const create = useCreateQuoteForCustomer();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const lookup = useCustomerLookup(debounced);

  const [customer, setCustomer] = useState<CustomerMatch | null>(null);

  // Draft seeded from the cart; the line id is the product id here.
  const [edits, setEdits] = useState<QuoteDraft | null>(null);
  const draft: QuoteDraft = edits ?? {
    items: items.map((i) => ({
      id: i.productId,
      name: i.name,
      catalog_price_cents: i.priceCents,
      quantity: i.quantity,
      unit_price_cents: i.priceCents,
    })),
    deliveryFeeCents: deliveryFeeCents(subtotal),
    discount: { type: "amount", cents: 0 },
    adminNote: "",
  };

  const send = () => {
    if (!customer) return;
    create.mutate({
      userId: customer.user_id,
      items: draft.items.map((i) => ({
        productId: i.id,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
      })),
      delivery_fee_cents: draft.deliveryFeeCents,
      discount: draft.discount,
      admin_note: draft.adminNote.trim() || null,
    });
  };

  if (items.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
        <ScreenHeader title="Cotizar a un cliente" />
        <EmptyState icon="bag-outline" title="El carrito está vacío" subtitle="Agrega productos al carrito primero" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Cotizar a un cliente" />
      <ScrollView contentContainerClassName="px-5 pb-6" keyboardShouldPersistTaps="handled">
        <Text className="mb-2 mt-2 font-quicksand-bold text-lg text-dark-100">Cliente</Text>
        {customer ? (
          <View className="flex-row items-center rounded-2xl bg-white p-4">
            <View className="flex-1">
              <Text className="font-quicksand-bold text-dark-100">
                {[customer.name, customer.last_name].filter(Boolean).join(" ") || customer.email}
              </Text>
              <Text className="font-quicksand-medium text-sm text-dark-100/60">{customer.email}</Text>
              {customer.phone ? (
                <Text className="font-quicksand-medium text-sm text-dark-100/60">{customer.phone}</Text>
              ) : null}
            </View>
            <Pressable onPress={() => setCustomer(null)} hitSlop={8}>
              <Text className="font-quicksand-bold text-sm text-primary">Cambiar</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Correo o teléfono del cliente"
              placeholderTextColor="rgba(16,36,31,0.35)"
              autoCapitalize="none"
              keyboardType="email-address"
              className="input mb-2"
            />
            {(lookup.data ?? []).map((c) => (
              <Pressable
                key={c.user_id}
                onPress={() => setCustomer(c)}
                className="mb-2 flex-row items-center rounded-2xl bg-white p-4"
              >
                <Ionicons name="person-circle-outline" size={28} color="#3E8368" />
                <View className="ml-3 flex-1">
                  <Text className="font-quicksand-bold text-dark-100">
                    {[c.name, c.last_name].filter(Boolean).join(" ") || c.email}
                  </Text>
                  <Text className="font-quicksand-medium text-sm text-dark-100/60">
                    {c.email}{c.phone ? ` · ${c.phone}` : ""}
                  </Text>
                </View>
              </Pressable>
            ))}
            {debounced.trim().length >= 3 && !lookup.isLoading && lookup.data?.length === 0 ? (
              <Text className="px-1 py-2 font-quicksand-medium text-sm text-dark-100/60">
                Sin resultados. Solo se puede cotizar a clientes registrados.
              </Text>
            ) : null}
          </>
        )}

        <View className="mt-6">
          <QuoteEditor draft={draft} onChange={setEdits} />
        </View>
      </ScrollView>

      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title="Enviar cotización"
          onPress={send}
          loading={create.isPending}
          disabled={!customer || draft.items.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}
```

Note: the `useEffect` here only schedules a timer and sets state from a timer callback (not synchronously in the effect), which is the same pattern `views/AdminProductList.tsx` uses and passes the lint rule.

- [ ] **Step 3: Typed routes + checks** — run the offline dev server ~110s (port 8089), confirm the port is free afterwards, then `npx tsc --noEmit` and `npx expo lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/admin/quote/new.tsx" "app/(protected)/cart.tsx"
git commit -m "Admin: send a cotización to a customer from the cart"
```

---

### Task 7: Customer accept/reject flow and "Por definir" display

**Files:**
- Create: `app/(protected)/order/accept/[id].tsx`
- Modify: `app/(protected)/order/[id].tsx`, `app/(protected)/admin/order/[id].tsx`, `views/OrderCard.tsx`, `models/quoteDocument.ts`

**Interfaces:**
- Consumes: `useAcceptQuote`, `usePayQuote`, `useCancelQuote`, `useOrder`, `useAddresses`, `DELIVERY_SLOTS`, `needsAcceptance`, `isAdminQuote`, `OrderTotals`.
- Produces: route `/order/accept/[id]`.

- [ ] **Step 1: Accept screen**

```tsx
// VIEW — customer accepts an admin-created cotización: picks address + slot,
// then "Aceptar y pagar" records them and starts the payment.
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAddresses } from "@/controllers/useAddresses";
import { useOrder } from "@/controllers/useOrders";
import { useAcceptQuote, usePayQuote } from "@/controllers/useQuote";
import { DELIVERY_SLOTS } from "@/models/delivery";
import { needsAcceptance } from "@/models/orderStatus";
import { formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function AcceptQuote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const { data: addresses } = useAddresses();
  const accept = useAcceptQuote();
  const pay = usePayQuote();

  const [chosenId, setChosenId] = useState<string | null>(null);
  const [slot, setSlot] = useState(DELIVERY_SLOTS[0]);
  const preferredId = addresses?.find((a) => a.is_default)?.id ?? addresses?.[0]?.id ?? null;
  const addressId = addresses?.some((a) => a.id === chosenId) ? chosenId : preferredId;

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }
  if (!needsAcceptance(order)) {
    router.replace(`/order/${order.id}`);
    return null;
  }

  const acceptAndPay = async () => {
    if (!addressId) return;
    try {
      await accept.mutateAsync({ orderId: order.id, addressId, deliverySlot: slot });
    } catch {
      return; // the hook already alerted
    }
    try {
      await pay.mutateAsync(order.id); // navigates to the result screen on success
    } catch {
      router.replace(`/order/${order.id}`); // address saved; Pagar is available there
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Aceptar cotización" />
      <ScrollView contentContainerClassName="px-5 pb-6">
        <Text className="mb-2 mt-2 font-quicksand-bold text-lg text-dark-100">Dirección de entrega</Text>
        {(addresses ?? []).map((address) => {
          const selected = address.id === addressId;
          return (
            <Pressable
              key={address.id}
              onPress={() => setChosenId(address.id)}
              className={`mb-2 flex-row items-center rounded-2xl border bg-white p-4 ${selected ? "border-primary" : "border-transparent"}`}
            >
              <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? "#3E8368" : "rgba(16,36,31,0.3)"} />
              <View className="ml-3 flex-1">
                <Text className="font-quicksand-bold text-dark-100">{address.label}</Text>
                <Text className="font-quicksand-medium text-sm text-dark-100/60">{address.street}, {address.city}</Text>
              </View>
            </Pressable>
          );
        })}
        <Pressable onPress={() => router.push("/account/addresses")} className="mb-4 flex-row items-center gap-1">
          <Ionicons name="add" size={16} color="#3E8368" />
          <Text className="font-quicksand-bold text-sm text-primary">Agregar dirección</Text>
        </Pressable>

        <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Horario de entrega</Text>
        <View className="flex-row flex-wrap gap-2">
          {DELIVERY_SLOTS.map((s) => {
            const active = s === slot;
            return (
              <Pressable key={s} onPress={() => setSlot(s)} className={active ? "chip-active" : "chip"}>
                <Text className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">Resumen</Text>
        <View className="rounded-2xl bg-white p-4">
          {order.order_items.map((item) => (
            <View key={item.id} className="mb-1 flex-row justify-between">
              <Text numberOfLines={1} className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/70">{item.quantity}× {item.name}</Text>
              <Text className="font-quicksand-semibold text-sm text-dark-100">{formatMXN(item.unit_price_cents * item.quantity)}</Text>
            </View>
          ))}
          <OrderTotals subtotal={order.subtotal_cents} discount={order.discount_cents} discountPercent={order.discount_percent} deliveryFee={order.delivery_fee_cents} total={order.total_cents} />
        </View>
      </ScrollView>
      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title={`Aceptar y pagar ${formatMXN(order.total_cents)}`}
          onPress={acceptAndPay}
          loading={accept.isPending || pay.isPending}
          disabled={!addressId}
        />
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Customer detail** (`app/(protected)/order/[id].tsx`): import `isAdminQuote, needsAcceptance` from `@/models/orderStatus` and `router` from `expo-router`. Render `order.delivery_slot || "Por definir"` and `order.delivery_address || "Por definir"`. After the date/badge card, when `isAdminQuote(order)` add:

```tsx
        {isAdminQuote(order) ? (
          <Text className="mt-3 px-1 font-quicksand-medium text-sm text-dark-100/60">
            Cotización enviada por LimpiezaApp. Acéptala para elegir dirección y horario, o recházala.
          </Text>
        ) : null}
```

In the footer, replace the Pagar block so that when `needsAcceptance(order)` the button is `title="Aceptar cotización"` with `onPress={() => router.push(`/order/accept/${order.id}`)}`; otherwise the existing Pagar button. Keep the cancel button (its label becomes `needsAcceptance(order) ? "Rechazar cotización" : "Cancelar cotización"`, and the confirm text "¿Seguro que quieres rechazarla?" in that case). Also change the footer condition to include `needsAcceptance(order)` (it already includes `canPay`, which is true for `quote_sent`, so no change is strictly needed; keep it as is).

- [ ] **Step 3: "Por definir" elsewhere** — `app/(protected)/admin/order/[id].tsx`: `{order.delivery_slot || "Por definir"}` and `{order.delivery_address || "Por definir"}`. `views/OrderCard.tsx`: `{order.delivery_slot || "Por definir"}`. `models/quoteDocument.ts`: `esc(order.delivery_address || "Por definir")` and `esc(order.delivery_slot || "Por definir")`.

- [ ] **Step 4: Typed routes + checks** — offline dev server ~110s (new route `/order/accept/[id]`), then `npx tsc --noEmit` and `npx expo lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/order/accept/[id].tsx" "app/(protected)/order/[id].tsx" "app/(protected)/admin/order/[id].tsx" views/OrderCard.tsx models/quoteDocument.ts
git commit -m "Customer accepts or rejects admin-created cotizaciones; Por definir placeholders"
```

---

### Task 8: Docs and verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md** — Commands: add `npx supabase functions deploy admin-users   # admin: customer lookup for admin-created quotes`. Security invariants: append to the cotización bullet: "Admin-created quotes (`created_by_admin` set) are inserted by `admin-orders` `create` with `address_id = null` and totals from `apply_quote_edit`; the customer's `accept` action records address/slot and `pay` refuses until then." Architecture → models: mention `lookupCustomers`/`createQuoteForCustomer`/`acceptQuote`.

- [ ] **Step 2: Static** — `npx tsc --noEmit`, `npx expo lint` clean; `mcp__supabase__list_edge_functions` shows `admin-users` ACTIVE and new versions of `admin-orders`/`quote-actions`.

- [ ] **Step 3: Manual (user)** — per the spec's Verification section.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document admin-created cotizaciones"
```

---

## Self-review notes

- Spec coverage: data (T1), lookup (T2), create (T3), accept + pay guard (T4), models/controllers (T5), admin screen + cart button (T6), customer accept/reject + placeholders in detail/admin/card/PDF (T7), docs (T8).
- Type consistency: `AdminCreateQuoteInput` (T5) matches `createSchema` (T3) field-for-field; `CustomerMatch` matches `admin-users`' select; `acceptQuote(orderId, addressId, deliverySlot)` matches the accept schema; `useCreateQuoteForCustomer` navigates to `/admin/order/[id]` which exists; the accept route is `/order/accept/[id]` (a sibling directory, not nested under the `[id].tsx` file, to avoid an expo-router file/directory clash).
- The T6 screen derives `draft` from `edits ?? seed` (no set-state effect); the debounce effect only schedules a timer, matching `AdminProductList`.
