// CONTROLLER — checkout: turns the cart into a cotización. The view only
// calls requestQuote(); this controller builds the request from the cart
// model, asks the server to create the quote (prices recomputed there),
// clears the cart and navigates to the result screen, which shows the
// "cotización enviada" state for a quote_requested row.
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { useCart } from "@/controllers/useCart";
import { requestQuote as requestQuoteModel } from "@/models/quoteModel";

export function useCheckout() {
  const items = useCart((s) => s.items);
  const clearCart = useCart((s) => s.clear);
  const [submitting, setSubmitting] = useState(false);

  /** Sends the current cart as a cotización. */
  const requestQuote = async (addressId: string | null, deliverySlot: string) => {
    if (!addressId) {
      Alert.alert("Falta dirección", "Agrega una dirección de entrega.");
      return;
    }
    if (items.length === 0) {
      router.back();
      return;
    }
    setSubmitting(true);
    try {
      const { orderId } = await requestQuoteModel({
        addressId,
        deliverySlot,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      // The quote now lives in Pedidos → Cotizaciones; the cart is done.
      clearCart();
      router.replace({ pathname: "/checkout/result", params: { order_id: orderId } });
    } catch (error) {
      Alert.alert("Error", error instanceof Error ? error.message : "Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return { requestQuote, submitting };
}
