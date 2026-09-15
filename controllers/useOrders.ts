// CONTROLLER — orders: read-only order history with smart polling that
// stops once an order reaches a state that can no longer change.
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import { fetchOrder, fetchOrders } from "@/models/orderModel";
import { isFinal, isPaymentSettled, isQuote } from "@/models/orderStatus";
import type { OrderKind, OrderWithItems } from "@/models/types";

/**
 * The caller's rows of one kind, newest first. One fetch serves both
 * filters: the split is derived from paid_at client-side.
 */
export function useOrders(kind: OrderKind, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["orders", session?.user.id],
    enabled: !!session && enabled,
    queryFn: fetchOrders,
    select: (orders) => orders.filter((o) => (kind === "quotes" ? isQuote(o) : !isQuote(o))),
  });
}

type OrderQueryState = { state: { data?: OrderWithItems | null } };

/**
 * One order with items (admins can read any row through RLS). Polls every
 * 5s while fulfillment is in progress, every 15s while it is an unpaid
 * quote waiting on the other party, and stops on delivered/cancelled.
 */
export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: (query: OrderQueryState) => {
      const order = query.state.data;
      if (!order) return 5000;
      if (isFinal(order.status)) return false;
      return isQuote(order) && order.status !== "pending" ? 15000 : 5000;
    },
    queryFn: () => fetchOrder(id!),
  });
}

/**
 * Same order query tuned for the result screen: polls every 3s only while
 * a payment is pending (the webhook settles it), then stops.
 */
export function useOrderPaymentStatus(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: (query: OrderQueryState) => {
      const order = query.state.data;
      return order && isPaymentSettled(order.status) ? false : 3000;
    },
    queryFn: () => fetchOrder(id!),
  });
}
