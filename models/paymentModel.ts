// MODEL — payments: the client side of the Mercado Pago flow.
// The client only ever sends product ids + quantities; every price is
// recomputed server-side by the create-order Edge Function, and payment
// truth comes exclusively from the mp-webhook Edge Function.
import * as WebBrowser from "expo-web-browser";

import { supabase } from "@/services/supabase";

export interface CheckoutRequest {
  addressId: string;
  deliverySlot: string;
  items: { productId: string; quantity: number }[];
}

export interface CheckoutResponse {
  orderId: string;
  initPoint: string;
}

/**
 * Creates the order server-side and returns the Mercado Pago Checkout Pro
 * URL. Amounts are never sent by the client, so a tampered cart cannot
 * change what is charged.
 */
export async function createOrder(
  request: CheckoutRequest
): Promise<CheckoutResponse> {
  const { data, error } = await supabase.functions.invoke("create-order", {
    body: request,
  });
  if (error) throw new Error("No se pudo crear el pedido. Intenta de nuevo.");
  return data as CheckoutResponse;
}

/**
 * Opens Mercado Pago checkout in an in-app browser (Custom Tabs / Safari
 * View Controller). Resolves when the limpiezaapp:// deep link fires or
 * the user closes the browser. The result URL is only used for navigation
 * — the order row (updated by the webhook) decides the real outcome.
 */
export async function openMercadoPagoCheckout(initPoint: string) {
  return WebBrowser.openAuthSessionAsync(
    initPoint,
    "limpiezaapp://checkout/result"
  );
}
