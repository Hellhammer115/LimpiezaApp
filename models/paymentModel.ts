// MODEL — payments: the client side of the Mercado Pago flow for a
// cotización the admin already sent. The quote-actions Edge Function builds
// the preference from the quoted total stored server-side, and payment
// truth comes exclusively from the mp-webhook Edge Function.
import * as WebBrowser from "expo-web-browser";

import { functionErrorMessage } from "@/models/functionError";
import { supabase } from "@/services/supabase";

/** Starts (or resumes) the payment of a sent cotización. */
export async function payQuote(orderId: string): Promise<{ initPoint: string }> {
  const { data, error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "pay", orderId },
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo iniciar el pago. Intenta de nuevo.")
    );
  }
  return data as { initPoint: string };
}

/**
 * Opens Mercado Pago checkout in an in-app browser (Custom Tabs / Safari
 * View Controller). Resolves when the limpiezaapp:// deep link fires or
 * the user closes the browser. The result URL is only used for navigation
 * — the order row (updated by the webhook) decides the real outcome.
 */
export async function openMercadoPagoCheckout(initPoint: string) {
  return WebBrowser.openAuthSessionAsync(initPoint, "limpiezaapp://checkout/result");
}
