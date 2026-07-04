import * as WebBrowser from "expo-web-browser";

import { supabase } from "@/lib/supabase";

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
 * Creates the order server-side (the Edge Function recomputes all prices from
 * the database — the client never sends amounts) and returns the Mercado Pago
 * Checkout Pro URL.
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
 * View Controller). Resolves when the user is redirected back to the
 * limpiezaapp:// deep link or closes the browser. The result URL is only
 * used for navigation — payment truth comes from the mp-webhook Edge
 * Function updating the order row.
 */
export async function openMercadoPagoCheckout(initPoint: string) {
  return WebBrowser.openAuthSessionAsync(
    initPoint,
    "limpiezaapp://checkout/result"
  );
}
