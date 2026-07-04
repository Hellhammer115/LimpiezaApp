import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type {
  Address,
  Category,
  Order,
  OrderWithItems,
  Product,
  Profile,
} from "@/lib/types";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}

export function useCategory(id: string | undefined) {
  return useQuery({
    queryKey: ["categories", id],
    enabled: !!id,
    queryFn: async (): Promise<Category | null> => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useProducts(options?: {
  categoryId?: string;
  search?: string;
  limit?: number;
}) {
  const { categoryId, search, limit } = options ?? {};
  return useQuery({
    queryKey: ["products", { categoryId, search, limit }],
    queryFn: async (): Promise<Product[]> => {
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
    },
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["products", id],
    enabled: !!id,
    queryFn: async (): Promise<Product | null> => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (patch: {
      name: string;
      last_name: string;
      phone: string | null;
    }) => {
      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("user_id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useAddresses() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["addresses", session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<Address[]> => {
      const { data, error } = await supabase
        .from("addresses")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveAddress() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (
      address: Partial<Address> & {
        street: string;
        city: string;
        label: string;
      }
    ) => {
      const { id, ...fields } = address;
      // Only one default address per user.
      if (fields.is_default) {
        const { error } = await supabase
          .from("addresses")
          .update({ is_default: false })
          .eq("user_id", session!.user.id);
        if (error) throw error;
      }
      if (id) {
        const { error } = await supabase
          .from("addresses")
          .update(fields)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("addresses")
          .insert({ ...fields, user_id: session!.user.id });
        if (error) throw error;
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["addresses"] }),
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["addresses"] }),
  });
}

const ORDER_WITH_ITEMS = `
  *,
  order_items ( *, products ( name, unit, image_url ) ),
  addresses ( label, street, colonia, city )
`;

export function useOrders() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["orders", session?.user.id],
    enabled: !!session,
    queryFn: async (): Promise<Order[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useOrder(
  id: string | undefined,
  options?: { refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: options?.refetchInterval ?? false,
    queryFn: async (): Promise<OrderWithItems | null> => {
      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_WITH_ITEMS)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as OrderWithItems | null;
    },
  });
}
