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
