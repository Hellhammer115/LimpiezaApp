// MODEL — catalog: read-only access to categories and products.
// The catalog is publicly readable (RLS allows select only); all writes
// happen through the Supabase dashboard / service role, never from the app.
import { DEMO_CATEGORIES, DEMO_MODE, DEMO_PRODUCTS } from "@/models/demoData";
import type { Category, Product } from "@/models/types";
import { supabase } from "@/services/supabase";

/** Returns all categories ordered for display. */
export async function fetchCategories(): Promise<Category[]> {
  if (DEMO_MODE) return DEMO_CATEGORIES;
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data;
}

/** Returns a single category, or null when it doesn't exist. */
export async function fetchCategory(id: string): Promise<Category | null> {
  if (DEMO_MODE) return DEMO_CATEGORIES.find((c) => c.id === id) ?? null;
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ProductFilter {
  /** Restrict to one category. */
  categoryId?: string;
  /** Case-insensitive substring match on the product name. */
  search?: string;
  /** Cap the number of results (e.g. featured sections). */
  limit?: number;
}

/** Returns active products matching the filter, ordered by name. */
export async function fetchProducts(filter: ProductFilter = {}): Promise<Product[]> {
  const { categoryId, search, limit } = filter;
  if (DEMO_MODE) {
    let result = DEMO_PRODUCTS;
    if (categoryId) result = result.filter((p) => p.category_id === categoryId);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    return limit ? result.slice(0, limit) : result;
  }
  let query = supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (categoryId) query = query.eq("category_id", categoryId);
  if (search) query = query.ilike("name", `%${search}%`);
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Returns a single active product, or null when it doesn't exist. */
export async function fetchProduct(id: string): Promise<Product | null> {
  if (DEMO_MODE) return DEMO_PRODUCTS.find((p) => p.id === id) ?? null;
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
