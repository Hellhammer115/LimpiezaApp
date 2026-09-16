// MODEL — cotizaciones (customer side). The client only ever sends product
// ids + quantities; the create-quote Edge Function recomputes every price.
import { functionErrorMessage } from "@/models/functionError";
import { supabase } from "@/services/supabase";

export interface QuoteRequest {
  addressId: string;
  deliverySlot: string;
  items: { productId: string; quantity: number }[];
}

/** Creates a cotización from the cart. Returns the new order id. */
export async function requestQuote(request: QuoteRequest): Promise<{ orderId: string }> {
  const { data, error } = await supabase.functions.invoke("create-quote", {
    body: request,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo enviar la cotización. Intenta de nuevo.")
    );
  }
  return data as { orderId: string };
}

/** Cancels the caller's own unpaid cotización. */
export async function cancelQuote(orderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "cancel", orderId },
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo cancelar la cotización.")
    );
  }
}

/** Permanently removes the caller's own cancelled cotización. */
export async function deleteQuote(orderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "delete", orderId },
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(error, "No se pudo eliminar la cotización.")
    );
  }
}

/** Accepts an admin-created quote by choosing the delivery address and slot. */
export async function acceptQuote(
  orderId: string,
  addressId: string,
  deliverySlot: string
): Promise<void> {
  const { error } = await supabase.functions.invoke("quote-actions", {
    body: { action: "accept", orderId, addressId, deliverySlot },
  });
  if (error) {
    throw new Error(await functionErrorMessage(error, "No se pudo aceptar la cotización."));
  }
}
