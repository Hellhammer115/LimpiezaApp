// quote-actions: the customer's actions on their own cotización.
//   pay    — creates the Mercado Pago preference for the QUOTED total (single
//            line item: MP rejects negative discount lines) and moves the row
//            to `pending`; the webhook decides the outcome.
//   cancel — cancels an unpaid quote.
//   delete — hides a cancelled, never-paid quote from the customer's list.
//   accept — records the address/slot chosen for an admin-created quote.
//   accept_update — accepts the admin's latest change to a sent quote; pay
//            refuses while an update is pending.
// Ownership is enforced by reading the order through the RLS-scoped client.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { getCaller } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), orderId: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), orderId: z.string().uuid() }),
  z.object({ action: z.literal("delete"), orderId: z.string().uuid() }),
  z.object({
    action: z.literal("accept_update"),
    orderId: z.string().uuid(),
    // The version the customer reviewed; a newer admin edit is not accepted.
    updatedAt: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("accept"),
    orderId: z.string().uuid(),
    addressId: z.string().uuid(),
    deliverySlot: z.string().min(1).max(100),
  }),
]);

/** The admin changed the sent quote and the customer hasn't accepted it yet. */
function hasPendingUpdate(order: {
  quote_updated_at: string | null;
  quote_update_accepted_at: string | null;
}): boolean {
  return (
    !!order.quote_updated_at &&
    (!order.quote_update_accepted_at ||
      Date.parse(order.quote_update_accepted_at) < Date.parse(order.quote_updated_at))
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { userClient, admin } = caller;

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
    const body = parsed.data;
    const { action, orderId } = body;

    // RLS: a customer can only see their own rows, so a foreign id is a 404.
    const { data: order, error: orderError } = await userClient
      .from("orders")
      .select(
        "id, status, total_cents, address_id, created_by_admin, mp_init_point, quote_updated_at, quote_update_accepted_at, order_items ( product_id, name, quantity )"
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json({ error: "Cotización no encontrada" }, 404);

    if (action === "cancel") {
      const { data: updated, error } = await admin
        .from("orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", orderId)
        .in("status", ["quote_requested", "quote_sent"])
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return json({ error: "La cotización ya no se puede cancelar" }, 409);
      }
      return json({ ok: true });
    }

    if (action === "accept_update") {
      if (body.action !== "accept_update") return json({ error: "Solicitud inválida" }, 400);
      // Guarded on the reviewed version: if the admin changed the quote again
      // meanwhile, the customer has to review that version first.
      const { data: accepted, error } = await admin
        .from("orders")
        .update({ quote_update_accepted_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "quote_sent")
        .eq("quote_updated_at", body.updatedAt)
        .select("id");
      if (error) throw error;
      if (!accepted || accepted.length === 0) {
        return json({ error: "La cotización cambió de nuevo, revisa los cambios" }, 409);
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      // "Delete" hides the row from the customer's list only; the admin keeps
      // seeing it until they hide it too, at which point the row is removed.
      const { data: hidden, error } = await admin
        .from("orders")
        .update({ hidden_by_customer_at: new Date().toISOString() })
        .eq("id", orderId)
        .eq("status", "cancelled")
        .is("paid_at", null)
        .select("id, hidden_by_admin_at");
      if (error) throw error;
      const row = hidden?.[0];
      if (!row) {
        return json({ error: "Solo se pueden eliminar cotizaciones canceladas" }, 409);
      }
      if (row.hidden_by_admin_at) {
        // Both sides hid it: physically remove (order_items cascade).
        await admin.from("orders").delete().eq("id", orderId);
      }
      return json({ ok: true });
    }

    if (action === "accept") {
      if (body.action !== "accept") return json({ error: "Solicitud inválida" }, 400);
      if (order.status !== "quote_sent" || !order.created_by_admin || order.address_id) {
        return json({ error: "Esta cotización no requiere aceptación" }, 409);
      }
      const { data: address } = await userClient
        .from("addresses")
        .select("id, label, street, colonia, city, zip")
        .eq("id", body.addressId)
        .maybeSingle();
      if (!address) return json({ error: "Dirección no encontrada" }, 400);
      const deliveryAddress = [
        `${address.label}: ${address.street}`,
        address.colonia,
        `${address.city} ${address.zip}`.trim(),
      ]
        .filter(Boolean)
        .join(", ");
      const { data: accepted, error } = await admin
        .from("orders")
        .update({
          address_id: address.id,
          delivery_address: deliveryAddress,
          delivery_slot: body.deliverySlot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "quote_sent")
        .is("address_id", null)
        .select("id");
      if (error) throw error;
      if (!accepted || accepted.length === 0) {
        return json({ error: "Esta cotización no requiere aceptación" }, 409);
      }
      return json({ ok: true });
    }

    // action === "pay"
    // Only admin-created quotes start without an address; a customer-requested
    // quote whose address was later deleted keeps its snapshot and stays payable.
    if (order.created_by_admin && !order.address_id) {
      return json({ error: "Elige una dirección y horario antes de pagar" }, 409);
    }
    if (hasPendingUpdate(order)) {
      return json({ error: "Acepta los cambios de la cotización antes de pagar" }, 409);
    }
    if (order.status === "pending" && order.mp_init_point) {
      // Customer closed the browser earlier; resume the same preference.
      return json({ initPoint: order.mp_init_point });
    }
    if (order.status !== "quote_sent" && order.status !== "pending") {
      return json({ error: "La cotización aún no está lista para pagar" }, 409);
    }

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpToken) {
      console.error("MP_ACCESS_TOKEN is not configured");
      return json({ error: "Pagos no configurados" }, 503);
    }

    // Stock re-check: the admin may have raised quantities, and time passed.
    const productIds = order.order_items.map((i) => i.product_id);
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, name, stock, is_active")
      .in("id", productIds);
    if (productsError) throw productsError;
    for (const item of order.order_items) {
      const product = products?.find((p) => p.id === item.product_id);
      if (!product || !product.is_active) {
        return json({ error: `Ya no disponible: ${item.name}` }, 409);
      }
      if (product.stock < item.quantity) {
        return json({ error: `Sin existencias: ${item.name}` }, 409);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const deepLink = `limpiezaapp://checkout/result?order_id=${order.id}`;
    const folio = order.id.slice(0, 8);
    const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
        // The quoted total may change between attempts (admin re-edit), so
        // the key includes it — MP would otherwise replay the old preference.
        "X-Idempotency-Key": `${order.id}-${order.total_cents}`,
      },
      body: JSON.stringify({
        items: [
          {
            id: order.id,
            title: `Cotización #${folio}`,
            quantity: 1,
            unit_price: order.total_cents / 100,
            currency_id: "MXN",
          },
        ],
        external_reference: order.id,
        notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
        back_urls: { success: deepLink, pending: deepLink, failure: deepLink },
        statement_descriptor: "LIMPIEZAAPP",
        metadata: { order_id: order.id },
      }),
    });
    if (!preferenceResponse.ok) {
      console.error("MP preference failed", await preferenceResponse.text());
      return json({ error: "No se pudo iniciar el pago" }, 502);
    }
    const preference = await preferenceResponse.json();

    const { data: updated, error: updateError } = await admin
      .from("orders")
      .update({
        status: "pending",
        mp_preference_id: preference.id,
        mp_init_point: preference.init_point,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .in("status", ["quote_sent", "pending"])
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return json({ error: "La cotización cambió, vuelve a intentarlo" }, 409);
    }

    return json({ initPoint: preference.init_point });
  } catch (error) {
    console.error("quote-actions failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
