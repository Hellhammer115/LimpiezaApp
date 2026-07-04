// MODEL — orders: read-only access to the caller's own orders.
// RLS guarantees a user can only ever read their own rows; orders are
// created and updated exclusively by Edge Functions (server side), so
// there are intentionally NO write functions here.
import type { Order, OrderWithItems } from "@/models/types";
import { supabase } from "@/services/supabase";

/** Returns the caller's orders, newest first. */
export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Returns one order with its item snapshots, or null when not found. */
export async function fetchOrder(id: string): Promise<OrderWithItems | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items ( * )")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as OrderWithItems | null;
}
