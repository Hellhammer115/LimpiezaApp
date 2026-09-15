// CONTROLLER — admin orders: everyone's cotizaciones/pedidos plus the
// admin's edit/send/reject/advance actions. Only mounted behind useIsAdmin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import {
  advanceOrder,
  listAdminOrders,
  rejectQuote,
  sendQuote,
  updateQuote,
} from "@/models/adminOrderModel";
import type { FulfillmentStatus, OrderKind, QuoteEditInput } from "@/models/types";

/** All rows of one kind, newest first. `enabled` = false for non-admin mounts. */
export function useAdminOrders(kind: OrderKind, search?: string, enabled = true) {
  return useQuery({
    queryKey: ["admin-orders", kind, search ?? ""],
    queryFn: () => listAdminOrders(kind, search),
    enabled,
  });
}

/** Admin list AND the customer-facing caches (a customer may be an admin too). */
function useInvalidateAllOrders() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
}

export function useUpdateQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuoteEditInput }) => updateQuote(id, input),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se guardó", error.message),
  });
}

export function useSendQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: (id: string) => sendQuote(id),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se envió", error.message),
  });
}

export function useRejectQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => rejectQuote(id, note),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se rechazó", error.message),
  });
}

export function useAdvanceOrder() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: FulfillmentStatus }) => advanceOrder(id, to),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("No se actualizó", error.message),
  });
}
