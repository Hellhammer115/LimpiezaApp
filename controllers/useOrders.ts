// CONTROLLER — orders: read-only order history with smart polling that
// stops once an order reaches a state that can no longer change.
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/controllers/useAuth";
import { fetchOrder, fetchOrders } from "@/models/orderModel";
import { isFinal, isPaymentSettled } from "@/models/orderStatus";
import type { OrderWithItems } from "@/models/types";

/** The caller's orders, newest first. */
export function useOrders() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["orders", session?.user.id],
    enabled: !!session,
    queryFn: fetchOrders,
  });
}

type OrderQueryState = { state: { data?: OrderWithItems | null } };

/**
 * One order with items. Polls every 5s while the order can still change
 * (fulfillment in progress) and stops on delivered/cancelled.
 */
export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["orders", "detail", id],
    enabled: !!id,
    refetchInterval: (query: OrderQueryState) => {
      const order = query.state.data;
      return order && isFinal(order.status) ? false : 5000;
    },
    queryFn: () => fetchOrder(id!),
  });
}

/**
 * Same order query tuned for the payment-result screen: polls every 3s
 * until the webhook settles the payment (paid or cancelled), then stops.
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
