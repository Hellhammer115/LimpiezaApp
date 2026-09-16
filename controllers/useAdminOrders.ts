// CONTROLLER — admin orders: everyone's cotizaciones/pedidos plus the
// admin's edit/send/reject/advance actions. Only mounted behind useIsAdmin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";

import {
  advanceOrder,
  createQuoteForCustomer,
  lookupCustomers,
  deleteQuote,
  listAdminOrders,
  rejectQuote,
  sendQuote,
  updateQuote,
} from "@/models/adminOrderModel";
import { useCart } from "@/controllers/useCart";
import type {
  AdminCreateQuoteInput,
  FulfillmentStatus,
  OrderKind,
  QuoteEditInput,
} from "@/models/types";

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

/** Deletes a cancelled quote, then returns to the admin list. Arg: order id. */
export function useAdminDeleteQuote() {
  const invalidate = useInvalidateAllOrders();
  return useMutation({
    mutationFn: (id: string) => deleteQuote(id),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (error) => Alert.alert("No se eliminó", error.message),
  });
}

/** Customers matching an email/phone fragment; disabled under 3 characters. */
export function useCustomerLookup(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["admin-users", trimmed],
    queryFn: () => lookupCustomers(trimmed),
    enabled: trimmed.length >= 3,
  });
}

/** Sends a quote to a customer, clears the cart and opens the admin detail. */
export function useCreateQuoteForCustomer() {
  const invalidate = useInvalidateAllOrders();
  const clearCart = useCart((s) => s.clear);
  return useMutation({
    mutationFn: (input: AdminCreateQuoteInput) => createQuoteForCustomer(input),
    onSuccess: (order) => {
      clearCart();
      invalidate();
      router.replace(`/admin/order/${order.id}`);
    },
    onError: (error) => Alert.alert("No se envió", error.message),
  });
}
