// CONTROLLER — catalog: exposes the catalog model to views as cached,
// auto-refreshing TanStack Query hooks. Views render `data` and never
// know where it came from (Supabase or demo data).
import { useQuery } from "@tanstack/react-query";

import {
  fetchCategories,
  fetchCategory,
  fetchProduct,
  fetchProducts,
  type ProductFilter,
} from "@/models/catalogModel";

/** All categories, ordered for display. */
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });
}

/** One category by id (used by the category screen header). */
export function useCategory(id: string | undefined) {
  return useQuery({
    queryKey: ["categories", id],
    enabled: !!id,
    queryFn: () => fetchCategory(id!),
  });
}

/** Active products filtered by category / search / limit. */
export function useProducts(filter?: ProductFilter) {
  return useQuery({
    queryKey: ["products", filter ?? {}],
    queryFn: () => fetchProducts(filter),
  });
}

/** One product by id (product detail screen). */
export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["products", id],
    enabled: !!id,
    queryFn: () => fetchProduct(id!),
  });
}
