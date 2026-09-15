// MODEL — orders: read-only access to the caller's own orders.
// Admins can read every row through RLS, so the "own orders" filter below
// is explicit — without it an admin's order-history screen would pull every
// customer's orders. Orders are created and updated exclusively by Edge
// Functions (server side), so there are intentionally NO write functions here.
import type { Order, OrderWithItems } from "@/models/types";
import { supabase } from "@/services/supabase";

/** Returns the given user's own orders, newest first. */
export async function fetchOrders(userId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
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
