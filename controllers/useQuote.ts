// CONTROLLER — customer actions on their own cotización: pay (opens Mercado
// Pago, then lands on the result screen which polls the webhook outcome)
// and cancel. Both refresh the orders cache.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";

import { openMercadoPagoCheckout, payQuote } from "@/models/paymentModel";
import { acceptQuote, acceptQuoteUpdate, cancelQuote, deleteQuote } from "@/models/quoteModel";

function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["orders"] });
}

/** Starts the Mercado Pago payment for a sent quote. Arg: order id. */
export function usePayQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { initPoint } = await payQuote(orderId);
      await openMercadoPagoCheckout(initPoint);
      router.replace({ pathname: "/checkout/result", params: { order_id: orderId } });
    },
    onSettled: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}

/** Cancels an unpaid quote. Arg: order id. */
export function useCancelQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (orderId: string) => cancelQuote(orderId),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}

/** Deletes a cancelled quote, then returns to the Pedidos tab. Arg: order id. */
export function useDeleteQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: (orderId: string) => deleteQuote(orderId),
    onSuccess: () => {
      invalidate();
      router.replace("/orders");
    },
    onError: (error) => Alert.alert("Error", error.message),
  });
}

/** Accepts the admin's latest change to a sent quote, unlocking payment. */
export function useAcceptQuoteUpdate() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({ orderId, updatedAt }: { orderId: string; updatedAt: string }) =>
      acceptQuoteUpdate(orderId, updatedAt),
    onSettled: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}

/** Records the customer's address/slot on an admin-created quote. */
export function useAcceptQuote() {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: ({
      orderId,
      addressId,
      deliverySlot,
    }: {
      orderId: string;
      addressId: string;
      deliverySlot: string;
    }) => acceptQuote(orderId, addressId, deliverySlot),
    onSuccess: invalidate,
    onError: (error) => Alert.alert("Error", error.message),
  });
}
