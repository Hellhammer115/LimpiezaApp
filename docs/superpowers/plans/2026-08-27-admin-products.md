# Admin Product Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a designated admin create, edit, and deactivate products from within the app, without weakening the "catalog is client-read-only" security invariant.

**Architecture:** A new `admin_users` table (client can only `select` its own row) gates a single new Edge Function, `admin-products`, which is the only path that ever writes to `products` — the table's existing public-read-only RLS is untouched. The app's MVC layers get a parallel admin slice (`models/adminModel.ts`, `controllers/useAdmin.ts`, `app/(protected)/admin/**`) that never touches `products` directly; every write goes through the Edge Function, and image uploads go straight to a new `product-images` Storage bucket (admin-write, public-read).

**Tech Stack:** Expo SDK 54 + React Native + expo-router + NativeWind, Supabase (Postgres/Auth/Storage/Edge Functions, Deno), TanStack Query, react-hook-form + zod, `expo-image-picker` + `expo-image-manipulator` (new dependencies).

## Global Constraints

- `products` table RLS is never modified — it keeps exactly its current public `select where is_active = true` policy and no write policy for any client role. (Spec → "Write path")
- All product writes (and the admin's read of inactive rows) go through the `admin-products` Edge Function only, deployed with JWT verification **on** (no `--no-verify-jwt`).
- `DELETE` on a product is always a soft delete (`is_active = false`) — never a real row delete, because `order_items.product_id` has no `ON DELETE` clause and would throw for any product that ever appeared in an order. (Spec → "Delete semantics")
- `updated_by` / `updated_at` on `products` are set exclusively by the Edge Function from the authenticated caller's id — never trusted from the request body even if a client sends `updated_by`. (Spec → "Audit fields")
- Money is always integer cents (`price_cents`); the admin form is the only place pesos are entered and converted ×100 on submit. (`CLAUDE.md` → Security invariants)
- Product images are resized (longest edge ≤ 1200px) and re-encoded as JPEG (~0.8 quality) client-side before upload — never the raw device file. (Spec → "Image uploads")
- No password column anywhere; admin promotion is manual SQL against `admin_users`, never an in-app role-management UI. (Spec → "Non-goals", `CLAUDE.md`)
- No automated test suite exists in this project (`CLAUDE.md` → Commands). Verification per task is `npx tsc --noEmit` / `npx expo lint` plus the concrete manual steps written into each task — there are no unit/integration tests to write.
- Windows: source files are UTF-8 without BOM; do not bulk-edit with PowerShell `Get-Content`/`Set-Content`. (`CLAUDE.md` → Gotchas)

---

### Task 1: Database migration — `admin_users`, audit columns, `product-images` bucket

**Files:**
- Create: `supabase/migrations/20260827120000_admin_products.sql`

**Interfaces:**
- Produces: `public.admin_users(user_id uuid pk, created_at)`; `public.products` gains `updated_at timestamptz`, `updated_by uuid`; storage bucket `product-images` with public read / admin-only write policies.
- Consumes: nothing (first task).

- [ ] **Step 1: Write the migration**

```sql
-- Admin product management: admin_users table, audit columns on products,
-- and a public-read/admin-write storage bucket for product images.
-- products RLS is intentionally untouched by this migration.

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create policy "admin_users: select own"
  on public.admin_users for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy for any client role: admins are promoted
-- by a developer running `insert into admin_users (user_id) values (...)`
-- directly against the Supabase SQL editor.

alter table public.products
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users (id) on delete set null;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);

create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product-images: admin insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

create policy "product-images: admin update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );

create policy "product-images: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.admin_users where user_id = auth.uid())
  );
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: the CLI reports the new migration applied with no errors.

- [ ] **Step 3: Verify in the Supabase SQL editor**

Run these two checks against the linked project:
```sql
select column_name from information_schema.columns
where table_name = 'products' and column_name in ('updated_at', 'updated_by');
-- expect 2 rows

select * from storage.buckets where id = 'product-images';
-- expect 1 row, public = true
```

- [ ] **Step 4: Promote your own account to admin**

In the SQL editor (replace with your actual auth user id, found in Authentication → Users):
```sql
insert into admin_users (user_id) values ('<your-uuid>');
```
This is needed for Task 2's manual curl checks and every later manual verification step in this plan.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260827120000_admin_products.sql
git commit -m "Add admin_users table, product audit columns, product-images bucket"
```

---

### Task 2: `admin-products` Edge Function

**Files:**
- Create: `supabase/functions/admin-products/index.ts`

**Interfaces:**
- Consumes: `admin_users`, `products` (Task 1).
- Produces the HTTP contract every later task relies on:
  - `GET admin-products?search=<optional>` → `200` `AdminProduct[]` (all products, active + inactive, each with `updated_by_email: string | null`).
  - `POST admin-products` body `{ category_id, name, description, price_cents, unit, image_url, stock, is_active }` → `200` single `AdminProduct`.
  - `PATCH admin-products` body `{ id, ...partial of the POST fields }` → `200` single `AdminProduct`.
  - `DELETE admin-products` body `{ id }` → `200` single `AdminProduct` with `is_active: false`.
  - `401` unauthenticated, `403` authenticated non-admin, `400` invalid body, `405` other methods.

- [ ] **Step 1: Write the function**

```ts
// admin-products: CRUD for the full product catalog (active + inactive),
// gated on membership in admin_users. products RLS stays untouched — this
// is the only write path, using the service role after the admin check.
// Deployed with verify_jwt = true.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const productInput = z.object({
  category_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  price_cents: z.number().int().min(0),
  unit: z.string().trim().min(1).max(50),
  image_url: z.string().url().nullable(),
  stock: z.number().int().min(0),
  is_active: z.boolean(),
});

const patchInput = productInput.partial().extend({ id: z.string().uuid() });
const deleteInput = z.object({ id: z.string().uuid() });

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);
    const user = userData.user;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Prohibido" }, 403);

    if (req.method === "GET") {
      const search = new URL(req.url).searchParams.get("search");
      let query = admin.from("products").select("*").order("name");
      if (search) query = query.ilike("name", `%${search}%`);
      const { data: products, error } = await query;
      if (error) throw error;

      // auth.users isn't PostgREST-joinable, so editor emails are resolved
      // through the Admin API — once per distinct editor in this batch.
      const editorIds = [
        ...new Set(
          products
            .map((p) => p.updated_by as string | null)
            .filter((id): id is string => !!id)
        ),
      ];
      const emailById = new Map<string, string>();
      for (const id of editorIds) {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data.user?.email) emailById.set(id, data.user.email);
      }
      const withEmail = products.map((p) => ({
        ...p,
        updated_by_email: p.updated_by ? (emailById.get(p.updated_by) ?? null) : null,
      }));
      return json(withEmail);
    }

    if (req.method === "POST") {
      const parsed = productInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("products")
        .insert({
          ...parsed.data,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "PATCH") {
      const parsed = patchInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { id, ...fields } = parsed.data;
      const { data, error } = await admin
        .from("products")
        .update({ ...fields, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    if (req.method === "DELETE") {
      const parsed = deleteInput.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { data, error } = await admin
        .from("products")
        .update({
          is_active: false,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", parsed.data.id)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ...data, updated_by_email: user.email ?? null });
    }

    return json({ error: "Método no permitido" }, 405);
  } catch (error) {
    console.error("admin-products failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

Run: `npx supabase functions deploy admin-products`
(No `--no-verify-jwt` — this function must reject unauthenticated callers.)

- [ ] **Step 3: Manual verification — unauthenticated call rejected**

```bash
curl -i -X GET "https://<project-ref>.supabase.co/functions/v1/admin-products"
```
Expected: `401`.

- [ ] **Step 4: Manual verification — non-admin call rejected**

Sign in through the running app as a non-admin user (or `curl` the Auth password grant endpoint), grab the `access_token`, then:
```bash
curl -i -X GET "https://<project-ref>.supabase.co/functions/v1/admin-products" \
  -H "Authorization: Bearer <non-admin access_token>"
```
Expected: `403`.

- [ ] **Step 5: Manual verification — admin call succeeds**

Using the access token for the account you promoted in Task 1 Step 4:
```bash
curl -i -X GET "https://<project-ref>.supabase.co/functions/v1/admin-products" \
  -H "Authorization: Bearer <admin access_token>"
```
Expected: `200` with a JSON array of all products (including any inactive ones), each with `updated_by_email` (likely `null` for pre-existing rows since they've never been edited by the Edge Function).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-products/index.ts
git commit -m "Add admin-products Edge Function (list/create/update/soft-delete)"
```

---

### Task 3: Types + core admin model (list/create/update/delete)

**Files:**
- Modify: `models/types.ts`
- Modify: `models/demoData.ts`
- Create: `models/adminModel.ts`

**Interfaces:**
- Consumes: `services/supabase.ts`, `admin-products` Edge Function (Task 2).
- Produces:
  - `AdminProduct = Product & { updated_by_email: string | null }` (types.ts)
  - `ProductInput` type, `checkIsAdmin(userId: string): Promise<boolean>`, `listAllProducts(search?: string): Promise<AdminProduct[]>`, `createProduct(input: ProductInput): Promise<AdminProduct>`, `updateProduct(id: string, patch: Partial<ProductInput>): Promise<AdminProduct>`, `deleteProduct(id: string): Promise<AdminProduct>` — consumed by Task 5.

- [ ] **Step 1: Extend `Product` and add `AdminProduct` in `models/types.ts`**

In the existing `Product` interface, add the two new fields (matches the migration in Task 1):

```ts
export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price_cents: number;
  unit: string;
  image_url: string | null;
  stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}
```

Then add, near the end of the file:

```ts
/** Product with the editor's email resolved — returned only by admin-products. */
export type AdminProduct = Product & { updated_by_email: string | null };
```

- [ ] **Step 2: Backfill the two new fields in `models/demoData.ts`**

The `product()` helper builds `Product` objects for demo mode; it must satisfy the now-larger interface. Change:

```ts
function product(
  id: number,
  categoryId: string,
  name: string,
  priceCents: number,
  unit: string,
  description: string,
  stock = 50
): Product {
  return {
    id: `d0000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    category_id: categoryId,
    name,
    description,
    price_cents: priceCents,
    unit,
    image_url: null,
    stock,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: null,
  };
}
```

- [ ] **Step 3: Run the typecheck to confirm the interface change is consistent so far**

Run: `npx tsc --noEmit`
Expected: no errors referencing `models/demoData.ts` or `models/types.ts` (there will still be no other admin code yet, so this should already pass cleanly).

- [ ] **Step 4: Write `models/adminModel.ts`**

```ts
// MODEL — admin: full-catalog reads/writes for admins only. All product
// writes go through the admin-products Edge Function (products RLS stays
// client-read-only). This file is only ever called from admin-gated
// controllers (see controllers/useAdmin.ts), never in demo mode.
import type { AdminProduct } from "@/models/types";
import { supabase } from "@/services/supabase";

/** True when the given user id has a row in admin_users. */
export async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function invokeAdminProducts<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  search?: string
): Promise<T> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const { data, error } = await supabase.functions.invoke(`admin-products${query}`, {
    method,
    body,
  });
  if (error) throw new Error("No se pudo completar la operación. Intenta de nuevo.");
  return data as T;
}

/** All products (active + inactive), optionally filtered by name. */
export async function listAllProducts(search?: string): Promise<AdminProduct[]> {
  return invokeAdminProducts<AdminProduct[]>("GET", undefined, search);
}

export interface ProductInput {
  category_id: string;
  name: string;
  description: string;
  price_cents: number;
  unit: string;
  image_url: string | null;
  stock: number;
  is_active: boolean;
}

/** Creates a new product. */
export async function createProduct(input: ProductInput): Promise<AdminProduct> {
  return invokeAdminProducts<AdminProduct>("POST", input);
}

/** Updates a product by id with a partial patch. */
export async function updateProduct(
  id: string,
  patch: Partial<ProductInput>
): Promise<AdminProduct> {
  return invokeAdminProducts<AdminProduct>("PATCH", { id, ...patch });
}

/** Soft-deletes (deactivates) a product; it can be reactivated by editing it. */
export async function deleteProduct(id: string): Promise<AdminProduct> {
  return invokeAdminProducts<AdminProduct>("DELETE", { id });
}
```

- [ ] **Step 5: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add models/types.ts models/demoData.ts models/adminModel.ts
git commit -m "Add AdminProduct type and core admin product model"
```

---

### Task 4: Image upload (resize/compress + storage)

**Files:**
- Modify: `package.json` (via `npx expo install`)
- Modify: `app.json`
- Modify: `models/adminModel.ts`

**Interfaces:**
- Consumes: `product-images` bucket (Task 1).
- Produces: `uploadProductImage(uri: string, width: number, height: number): Promise<string>` — consumed by Task 5/6.

- [ ] **Step 1: Install the new dependencies**

Run: `npx expo install expo-image-picker expo-image-manipulator`
Expected: `package.json` gains both packages at their SDK-54-compatible versions.

- [ ] **Step 2: Register the `expo-image-picker` config plugin**

In `app.json`, add to the `plugins` array (after `"expo-secure-store"`):

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Permite acceso a tus fotos para elegir la imagen de un producto."
  }
]
```

- [ ] **Step 3: Add `uploadProductImage` to `models/adminModel.ts`**

Add this import at the top of the file:

```ts
import * as ImageManipulator from "expo-image-manipulator";
```

Append the function:

```ts
/**
 * Resizes the picked image so its longest edge is ≤1200px, re-encodes it as
 * JPEG (~0.8 quality), uploads it to the product-images bucket, and returns
 * its public URL. `width`/`height` come from the picker's asset metadata —
 * they decide which edge to constrain so portrait photos aren't stretched.
 */
export async function uploadProductImage(
  uri: string,
  width: number,
  height: number
): Promise<string> {
  const longestEdge = Math.max(width, height);
  const actions =
    longestEdge > 1200
      ? [{ resize: width >= height ? { width: 1200 } : { height: 1200 } }]
      : [];
  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const response = await fetch(manipulated.uri);
  const arrayBuffer = await response.arrayBuffer();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, arrayBuffer, { contentType: "image/jpeg" });
  if (error) throw new Error("No se pudo subir la imagen. Intenta de nuevo.");

  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}
```

- [ ] **Step 4: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `expo-image-manipulator`'s types aren't picked up, re-run `npx expo start --clear` once so Metro/TS server refreshes (per `CLAUDE.md` gotchas) and try again.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json models/adminModel.ts
git commit -m "Add image resize/compress upload to admin product model"
```

---

### Task 5: `controllers/useAdmin.ts`

**Files:**
- Create: `controllers/useAdmin.ts`

**Interfaces:**
- Consumes: `models/adminModel.ts` (Tasks 3–4), `controllers/useAuth.tsx` (`useAuth`), `models/demoData.ts` (`DEMO_MODE`).
- Produces: `useIsAdmin()`, `useAdminProducts(search?: string)`, `useCreateProduct()`, `useUpdateProduct()`, `useDeleteProduct()`, `useUploadProductImage()` — consumed by Tasks 6–9.

- [ ] **Step 1: Write the controller**

```ts
// CONTROLLER — admin: gates the admin section and exposes full-catalog
// CRUD to admin views. Disabled entirely outside a real session (and
// always false in demo mode, which has no backend).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import {
  checkIsAdmin,
  createProduct,
  deleteProduct,
  listAllProducts,
  updateProduct,
  uploadProductImage,
  type ProductInput,
} from "@/models/adminModel";
import { DEMO_MODE } from "@/models/demoData";

/** True when the signed-in user is an admin (always false in demo mode). */
export function useIsAdmin() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["is-admin", userId],
    enabled: !DEMO_MODE && !!userId,
    queryFn: () => checkIsAdmin(userId!),
  });
}

/** All products (active + inactive), for the admin list/search screen. */
export function useAdminProducts(search?: string) {
  return useQuery({
    queryKey: ["admin-products", search ?? ""],
    queryFn: () => listAllProducts(search),
  });
}

/** Shared invalidation: admin screens AND the shopper-facing catalog both refresh. */
function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (input: ProductInput) => createProduct(input),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProductInput> }) =>
      updateProduct(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: invalidate,
  });
}

export function useUploadProductImage() {
  return useMutation({
    mutationFn: ({ uri, width, height }: { uri: string; width: number; height: number }) =>
      uploadProductImage(uri, width, height),
  });
}
```

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add controllers/useAdmin.ts
git commit -m "Add useAdmin controller (isAdmin, product CRUD, image upload)"
```

---

### Task 6: `views/ProductForm.tsx`

**Files:**
- Create: `views/ProductForm.tsx`

**Interfaces:**
- Consumes: `controllers/useAdmin.ts` (`useCreateProduct`, `useUpdateProduct`, `useDeleteProduct`, `useUploadProductImage`), `controllers/useCatalog.ts` (`useCategories`), `models/types.ts` (`AdminProduct`), `views/FormInput.tsx`, `views/PrimaryButton.tsx`, `utils/format.ts` (`formatDate`).
- Produces: `ProductForm({ product }: { product?: AdminProduct })` — `product` absent means create mode. Consumed by Task 8.

- [ ] **Step 1: Write the component**

```tsx
// VIEW — shared form for creating and editing a product (admin only).
// Presence of `product` picks the mode: undefined = create, set = edit.
import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { z } from "zod";

import { useCategories } from "@/controllers/useCatalog";
import {
  useCreateProduct,
  useDeleteProduct,
  useUpdateProduct,
  useUploadProductImage,
} from "@/controllers/useAdmin";
import type { AdminProduct } from "@/models/types";
import { formatDate } from "@/utils/format";
import { FormInput } from "@/views/FormInput";
import { PrimaryButton } from "@/views/PrimaryButton";

const schema = z.object({
  name: z.string().trim().min(1, "Nombre requerido"),
  description: z.string().trim(),
  category_id: z.string().uuid("Selecciona una categoría"),
  price: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Precio inválido"),
  unit: z.string().trim().min(1, "Unidad requerida"),
  stock: z.string().trim().regex(/^\d+$/, "Cantidad inválida"),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

export function ProductForm({ product }: { product?: AdminProduct }) {
  const { data: categories } = useCategories();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const uploadImage = useUploadProductImage();

  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);

  const { control, handleSubmit, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? "",
      description: product?.description ?? "",
      category_id: product?.category_id ?? "",
      price: product ? (product.price_cents / 100).toFixed(2) : "",
      unit: product?.unit ?? "",
      stock: product ? String(product.stock) : "",
      is_active: product?.is_active ?? true,
    },
  });

  const categoryId = watch("category_id");
  const isActive = watch("is_active");

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso requerido", "Habilita acceso a tus fotos para elegir una imagen.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      const url = await uploadImage.mutateAsync({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      });
      setImageUrl(url);
    } catch {
      Alert.alert("Error", "No se pudo subir la imagen.");
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      category_id: values.category_id,
      name: values.name,
      description: values.description,
      price_cents: Math.round(parseFloat(values.price) * 100),
      unit: values.unit,
      image_url: imageUrl,
      stock: parseInt(values.stock, 10),
      is_active: values.is_active,
    };
    try {
      if (product) {
        await updateProduct.mutateAsync({ id: product.id, patch: input });
      } else {
        await createProduct.mutateAsync(input);
      }
      router.back();
    } catch {
      Alert.alert("Error", "No se pudo guardar el producto.");
    }
  });

  const confirmDelete = () => {
    if (!product) return;
    Alert.alert("Eliminar producto", `¿Desactivar "${product.name}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await deleteProduct.mutateAsync(product.id);
          router.back();
        },
      },
    ]);
  };

  const saving = createProduct.isPending || updateProduct.isPending;

  return (
    <View className="px-5 pb-10 pt-2">
      <Pressable
        onPress={pickImage}
        className="mb-4 h-40 items-center justify-center overflow-hidden rounded-2xl bg-white"
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <View className="items-center">
            <Ionicons name="camera-outline" size={28} color="#3E8368" />
            <Text className="mt-1 font-quicksand-semibold text-sm text-dark-100/60">
              {uploadImage.isPending ? "Subiendo…" : "Agregar imagen"}
            </Text>
          </View>
        )}
      </Pressable>

      <FormInput control={control} name="name" label="Nombre" />
      <FormInput control={control} name="description" label="Descripción" multiline />

      <Text className="label mb-1">Categoría</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {(categories ?? []).map((c) => {
          const active = c.id === categoryId;
          return (
            <Pressable
              key={c.id}
              onPress={() => setValue("category_id", c.id, { shouldValidate: true })}
              className={active ? "chip-active" : "chip"}
            >
              <Text
                className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}
              >
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FormInput control={control} name="price" label="Precio (MXN)" keyboardType="decimal-pad" />
      <FormInput control={control} name="unit" label="Unidad" placeholder="kg, pieza, botella…" />
      <FormInput control={control} name="stock" label="Existencias" keyboardType="number-pad" />

      <View className="mb-4 flex-row items-center justify-between rounded-2xl bg-white p-4">
        <Text className="font-quicksand-bold text-dark-100">Activo</Text>
        <Switch value={isActive} onValueChange={(v) => setValue("is_active", v)} trackColor={{ true: "#3E8368" }} />
      </View>

      {product ? (
        <Text className="mb-4 font-quicksand-medium text-xs text-dark-100/50">
          Última edición: {product.updated_by_email ?? "—"} · {formatDate(product.updated_at)}
        </Text>
      ) : null}

      <PrimaryButton
        title={product ? "Guardar cambios" : "Crear producto"}
        onPress={onSubmit}
        loading={saving}
      />

      {product ? (
        <Pressable onPress={confirmDelete} className="mt-3 items-center py-2">
          <Text className="font-quicksand-semibold text-coral">Eliminar producto</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Nothing renders this component yet — Task 8 wires it up — so this only confirms the component itself compiles.)

- [ ] **Step 3: Commit**

```bash
git add views/ProductForm.tsx
git commit -m "Add shared ProductForm view for create/edit"
```

---

### Task 7: Admin layout guard + product list screen

**Files:**
- Create: `app/(protected)/admin/_layout.tsx`
- Create: `app/(protected)/admin/index.tsx`

**Interfaces:**
- Consumes: `controllers/useAdmin.ts` (`useIsAdmin`, `useAdminProducts`), `views/EmptyState.tsx`, `utils/format.ts` (`formatMXN`).

- [ ] **Step 1: Write the guard**

```tsx
// VIEW — admin group guard: reachable only for signed-in admins.
import { Redirect, Stack } from "expo-router";

import { useIsAdmin } from "@/controllers/useAdmin";

export default function AdminLayout() {
  const { data: isAdmin, isLoading } = useIsAdmin();

  if (isLoading) return null;
  if (!isAdmin) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 2: Write the list screen**

```tsx
// VIEW — admin product list: search, active/inactive badges, create/edit entry points.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminProducts } from "@/controllers/useAdmin";
import { formatMXN } from "@/utils/format";
import { EmptyState } from "@/views/EmptyState";

export default function AdminProducts() {
  const [search, setSearch] = useState("");
  const { data: products, isLoading } = useAdminProducts(search || undefined);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <Text className="font-quicksand-bold text-2xl text-dark-100">Productos</Text>
        <Pressable
          onPress={() => router.push("/admin/product/new")}
          className="size-10 items-center justify-center rounded-full bg-primary"
        >
          <Ionicons name="add" size={22} color="white" />
        </Pressable>
      </View>

      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar producto…"
          placeholderTextColor="rgba(16,36,31,0.35)"
          className="input"
        />
      </View>

      <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        {(products ?? []).map((product) => (
          <Pressable
            key={product.id}
            onPress={() => router.push(`/admin/product/${product.id}`)}
            className="mb-3 flex-row items-center justify-between rounded-2xl bg-white p-4"
          >
            <View className="flex-1 pr-3">
              <Text className="font-quicksand-bold text-dark-100">{product.name}</Text>
              <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
                {formatMXN(product.price_cents)} · {product.stock} en existencia
              </Text>
            </View>
            <View
              className={`rounded-full px-2 py-0.5 ${product.is_active ? "bg-primary/15" : "bg-coral/15"}`}
            >
              <Text
                className={`font-quicksand-bold text-[10px] ${product.is_active ? "text-primary" : "text-coral"}`}
              >
                {product.is_active ? "Activo" : "Inactivo"}
              </Text>
            </View>
          </Pressable>
        ))}

        {!isLoading && products?.length === 0 ? (
          <EmptyState
            icon="cube-outline"
            title="Sin productos"
            subtitle="Crea el primero con el botón +"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Run the typecheck**

Run: `npx expo start --clear` once in the background (typed routes for the new `admin/` segment only regenerate while the dev server has run — per `CLAUDE.md` gotchas), then in another terminal:
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

With the dev server running and signed in as the admin account from Task 1 Step 4, navigate to `/admin` (e.g. temporarily via a direct `router.push("/admin")` call, since the account-tab entry point is added in Task 9). Confirm: the product list loads with active/inactive badges, and the search box filters it. Then sign in as a non-admin account and confirm navigating to `/admin` redirects to home instead of showing the list.

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/admin/_layout.tsx" "app/(protected)/admin/index.tsx"
git commit -m "Add admin guard and product list screen"
```

---

### Task 8: New/edit product routes

**Files:**
- Create: `app/(protected)/admin/product/new.tsx`
- Create: `app/(protected)/admin/product/[id].tsx`

**Interfaces:**
- Consumes: `views/ProductForm.tsx` (Task 6), `controllers/useAdmin.ts` (`useAdminProducts`, Task 5).

- [ ] **Step 1: Write the create route**

```tsx
// VIEW — create-product screen: thin wrapper around the shared form.
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductForm } from "@/views/ProductForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function NewProduct() {
  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Nuevo producto" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          <ProductForm />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Write the edit route**

The admin product list (Task 7) is already loaded with every product by the time a row is tapped, so the edit screen finds its product from that same cached query instead of adding a new single-product Edge Function route.

```tsx
// VIEW — edit-product screen: finds the product from the cached admin list,
// then renders the shared form in edit mode.
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminProducts } from "@/controllers/useAdmin";
import { ProductForm } from "@/views/ProductForm";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: products, isLoading } = useAdminProducts();
  const product = products?.find((p) => p.id === id);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title="Editar producto" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
          {product ? (
            <ProductForm product={product} />
          ) : isLoading ? (
            <ActivityIndicator className="mt-10" color="#3E8368" />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Run the typecheck**

Run: `npx expo start --clear` once in the background so the new `admin/product/[id]` and `admin/product/new` routes are picked up by typed routes, then:
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification**

From `/admin`, tap the "+" button → fill the form (name, description, pick a category chip, price, unit, stock, pick an image) → submit → confirm it navigates back and the new product appears in the list. Tap that product → confirm the form is pre-filled correctly, the "Última edición" line shows your account's email and a recent timestamp, change a field and save → confirm the change is reflected in the list. Tap "Eliminar producto" on a product, confirm the alert, confirm it now shows "Inactivo" in the list instead of disappearing.

- [ ] **Step 5: Commit**

```bash
git add "app/(protected)/admin/product/new.tsx" "app/(protected)/admin/product/[id].tsx"
git commit -m "Add create/edit product routes"
```

---

### Task 9: Account tab entry point + end-to-end verification

**Files:**
- Modify: `app/(protected)/(tabs)/account.tsx`

**Interfaces:**
- Consumes: `controllers/useAdmin.ts` (`useIsAdmin`, Task 5).

- [ ] **Step 1: Add the conditional "Admin" row**

Add the import:
```ts
import { useIsAdmin } from "@/controllers/useAdmin";
```

Inside the `Account` component, alongside the existing `useProfile()` call:
```ts
const { data: isAdmin } = useIsAdmin();
```

In the JSX, add a new `AccountRow` between "Mis pedidos" and "Cerrar sesión":
```tsx
{isAdmin ? (
  <AccountRow
    icon="shield-checkmark-outline"
    label="Admin"
    onPress={() => router.push("/admin")}
  />
) : null}
```

- [ ] **Step 2: Run the typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx expo lint`
Expected: both PASS with no new errors/warnings.

- [ ] **Step 3: End-to-end manual verification**

Using the running app:
1. Sign in as a **non-admin** account. On the Cuenta tab, confirm there is no "Admin" row. Confirm manually navigating to `/admin` redirects to home.
2. Sign in as the **admin** account (from Task 1 Step 4). Confirm the "Admin" row appears and opens the product list.
3. Create a product, edit it, deactivate it — confirm each change is reflected both in the admin list and (for active products) on the shopper-facing category/search screens, and that a deactivated product disappears from the shopper-facing screens but stays visible (as "Inactivo") in the admin list.
4. Confirm the "Última edición" attribution updates to the current admin account and a fresh timestamp after each edit.
5. Confirm an uploaded image looks correctly sized/compressed (spot-check file size in Supabase Storage — it should be noticeably smaller than the original camera-roll photo for a large source image).

- [ ] **Step 4: Commit**

```bash
git add "app/(protected)/(tabs)/account.tsx"
git commit -m "Add Admin entry point to the account tab"
```

---
