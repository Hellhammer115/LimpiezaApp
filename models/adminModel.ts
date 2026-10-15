// MODEL — admin: full-catalog reads/writes for admins only. All product
// writes go through the admin-products Edge Function (products RLS stays
// client-read-only). This file is only ever called from admin-gated
// controllers (see controllers/useAdmin.ts), never in demo mode.
import { functionErrorMessage } from "@/models/functionError";
import type { AdminCategory, AdminProduct } from "@/models/types";
import { supabase } from "@/services/supabase";
import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Platform } from "react-native";

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

export async function invokeAdminFunction<T>(
  fn: "admin-products" | "admin-categories" | "admin-orders" | "admin-users",
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  query?: Record<string, string | undefined>
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  // Not `params.size`: react-native-url-polyfill's URLSearchParams has no
  // size getter, so that check is always false and the query gets dropped.
  const queryString = params.toString();
  const suffix = queryString ? `?${queryString}` : "";
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

/** Page size of the admin product list. */
export const ADMIN_PRODUCTS_PAGE = 50;

/**
 * One page of all products (active + inactive), ordered by name, optionally
 * filtered by name or Clave. Paged because the catalog exceeds PostgREST's
 * 1000-row response cap.
 */
export async function listAllProducts(search: string | undefined, offset: number): Promise<AdminProduct[]> {
  return invokeAdminFunction<AdminProduct[]>("admin-products", "GET", undefined, {
    search,
    offset: String(offset),
    limit: String(ADMIN_PRODUCTS_PAGE),
  });
}

/** A single product by id (active or not), for the edit screen. */
export async function getAdminProduct(id: string): Promise<AdminProduct> {
  return invokeAdminFunction<AdminProduct>("admin-products", "GET", undefined, { id });
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
  sku: string | null;
  sat_key: string | null;
  brand: string | null;
  code: string | null;
  pieces_per_box: number | null;
  dozen_price_cents: number | null;
}

/** Creates a new product. */
export async function createProduct(input: ProductInput): Promise<AdminProduct> {
  return invokeAdminFunction<AdminProduct>("admin-products", "POST", input);
}

/** Updates a product by id with a partial patch. */
export async function updateProduct(
  id: string,
  patch: Partial<ProductInput>
): Promise<AdminProduct> {
  return invokeAdminFunction<AdminProduct>("admin-products", "PATCH", { id, ...patch });
}

/** Soft-deletes (deactivates) a product; it can be reactivated by editing it. */
export async function deleteProduct(id: string): Promise<AdminProduct> {
  return invokeAdminFunction<AdminProduct>("admin-products", "DELETE", { id });
}

/** All categories (active + inactive), ordered for display. */
export async function listAllCategories(): Promise<AdminCategory[]> {
  return invokeAdminFunction<AdminCategory[]>("admin-categories", "GET");
}

export interface CategoryInput {
  name: string;
  icon: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
}

/** Creates a new category. */
export async function createCategory(input: CategoryInput): Promise<AdminCategory> {
  return invokeAdminFunction<AdminCategory>("admin-categories", "POST", input);
}

/** Updates a category by id with a partial patch. */
export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput>
): Promise<AdminCategory> {
  return invokeAdminFunction<AdminCategory>("admin-categories", "PATCH", { id, ...patch });
}

/** Soft-deletes (deactivates) a category; it can be reactivated by editing it. */
export async function deleteCategory(id: string): Promise<AdminCategory> {
  return invokeAdminFunction<AdminCategory>("admin-categories", "DELETE", { id });
}

/**
 * Reads a local image into bytes. On native, `fetch(file://…)` can resolve
 * with a "File not found" text body instead of failing, and that text got
 * uploaded as a 14-byte ".jpg"; expo-file-system reads the file directly.
 * Web picker URIs are blob:/data: URLs, which fetch handles fine.
 */
async function readImageBytes(uri: string): Promise<ArrayBuffer> {
  let bytes: ArrayBuffer;
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("No se pudo leer la imagen.");
    bytes = await response.arrayBuffer();
  } else {
    bytes = await new File(uri).arrayBuffer();
  }
  // Never upload an empty/garbage body as an image.
  if (bytes.byteLength < 1024) throw new Error("No se pudo leer la imagen.");
  return bytes;
}

/**
 * Resizes the picked image so its longest edge is ≤1200px, re-encodes it as
 * JPEG (~0.8 quality), uploads it to the product-images bucket (category
 * photos under a categories/ prefix), and returns its public URL.
 * `width`/`height` come from the picker's asset metadata — they decide which
 * edge to constrain so portrait photos aren't stretched.
 */
export async function uploadCatalogImage(
  uri: string,
  width: number,
  height: number,
  kind: "product" | "category" = "product"
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

  const arrayBuffer = await readImageBytes(manipulated.uri);
  const prefix = kind === "category" ? "categories/" : "";
  const path = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, arrayBuffer, { contentType: "image/jpeg" });
  if (error) throw new Error("No se pudo subir la imagen. Intenta de nuevo.");

  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}
