// CONTROLLER — checkout: orchestrates the payment flow. The view only
// calls pay(); this controller builds the request from the cart model,
// asks the server to create the order (prices recomputed there), opens
// the Mercado Pago in-app browser, and navigates to the result screen —
// which polls the order row because the webhook, not the browser redirect,
// decides the real payment outcome.
import { router } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { useCart } from "@/controllers/useCart";
import {
  createOrder,
  openMercadoPagoCheckout,
} from "@/models/paymentModel";

export function useCheckout() {
  const items = useCart((s) => s.items);
  const [paying, setPaying] = useState(false);

  /** Starts the Mercado Pago payment for the current cart. */
  const pay = async (addressId: string | null, deliverySlot: string) => {
    if (!addressId) {
      Alert.alert("Falta dirección", "Agrega una dirección de entrega.");
      return;
    }
    if (items.length === 0) {
      router.back();
      return;
    }
    setPaying(true);
    try {
      const { orderId, initPoint } = await createOrder({
        addressId,
        deliverySlot,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      });
      // The cart is intentionally NOT cleared here — the result screen
      // clears it only once the order is actually paid.
      await openMercadoPagoCheckout(initPoint);
      router.replace({
        pathname: "/checkout/result",
        params: { order_id: orderId },
      });
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Intenta de nuevo."
      );
    } finally {
      setPaying(false);
    }
  };

  return { pay, paying };
}
