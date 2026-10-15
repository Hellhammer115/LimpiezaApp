// CONTROLLER — admin orders: everyone's cotizaciones/pedidos plus the
// admin's edit/send/reject/advance actions. Only mounted behind useIsAdmin.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";

import {
  ADMIN_ORDERS_PAGE,
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

/**
 * Rows of one kind, newest first, loaded a page at a time — call
 * `fetchNextPage()` as the list nears its end. `enabled` = false for
 * non-admin mounts.
 */
export function useAdminOrders(kind: OrderKind, search?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["admin-orders", kind, search ?? ""],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listAdminOrders(kind, search, pageParam),
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      lastPage.length === ADMIN_ORDERS_PAGE ? lastOffset + ADMIN_ORDERS_PAGE : undefined,
    select: (data) => data.pages.flat(),
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
