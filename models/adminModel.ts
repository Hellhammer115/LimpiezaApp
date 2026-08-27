// MODEL — admin: full-catalog reads/writes for admins only. All product
// writes go through the admin-products Edge Function (products RLS stays
// client-read-only). This file is only ever called from admin-gated
// controllers (see controllers/useAdmin.ts), never in demo mode.
import type { AdminProduct } from "@/models/types";
import { supabase } from "@/services/supabase";
import * as ImageManipulator from "expo-image-manipulator";

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
    body: body as Record<string, unknown> | undefined,
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
