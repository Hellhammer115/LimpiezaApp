// create-quote: turns the caller's cart into a cotización (orders row with
// status quote_requested). Every price is recomputed from the database —
// client-sent amounts are never trusted. No payment happens here: the
// customer pays later through quote-actions once an admin sends the quote.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { listAdminEmails } from "../_shared/adminEmails.ts";
import { getCaller } from "../_shared/auth.ts";
import { deliveryFeeCents } from "../_shared/delivery.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";

const quoteSchema = z.object({
  addressId: z.string().uuid(),
  deliverySlot: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { userClient, admin, user } = caller;

    const parsed = quoteSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
    const { addressId, deliverySlot, items } = parsed.data;

    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      return json({ error: "Solicitud inválida" }, 400);
    }

    const [addressResult, productsResult, profileResult] = await Promise.all([
      // Address ownership is enforced by RLS through the user client.
      userClient
        .from("addresses")
        .select("label, street, colonia, city, zip")
        .eq("id", addressId)
        .maybeSingle(),
      admin
        .from("products")
        .select("id, name, price_cents, stock, is_active")
        .in("id", productIds),
      admin
        .from("profiles")
        .select("name, last_name, phone, email")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const address = addressResult.data;
    if (!address) return json({ error: "Dirección no encontrada" }, 400);
    if (productsResult.error) throw productsResult.error;
    const products = productsResult.data;
    const profile = profileResult.data;

    const deliveryAddress = [
      `${address.label}: ${address.street}`,
      address.colonia,
      `${address.city} ${address.zip}`.trim(),
    ]
      .filter(Boolean)
      .join(", ");

    let subtotalCents = 0;
    const orderItems: {
      product_id: string;
      name: string;
      quantity: number;
      unit_price_cents: number;
      catalog_price_cents: number;
    }[] = [];

    for (const item of items) {
      const product = products?.find((p) => p.id === item.productId);
      if (!product || !product.is_active) {
        return json({ error: "Un producto ya no está disponible" }, 409);
      }
      if (product.stock < item.quantity) {
        return json({ error: `Sin existencias: ${product.name}` }, 409);
      }
      subtotalCents += product.price_cents * item.quantity;
      orderItems.push({
        product_id: product.id,
        name: product.name,
        quantity: item.quantity,
        unit_price_cents: product.price_cents,
        catalog_price_cents: product.price_cents,
      });
    }

    const feeCents = deliveryFeeCents(subtotalCents);
    const customerName = [profile?.name, profile?.last_name].filter(Boolean).join(" ").trim();

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        user_id: user.id,
        address_id: addressId,
        delivery_address: deliveryAddress,
        status: "quote_requested",
        subtotal_cents: subtotalCents,
        discount_cents: 0,
        delivery_fee_cents: feeCents,
        total_cents: subtotalCents + feeCents,
        delivery_slot: deliverySlot,
        customer_name: customerName,
        customer_phone: profile?.phone ?? null,
        customer_email: profile?.email ?? user.email ?? "",
      })
      .select("id")
      .single();
    if (orderError) throw orderError;

    const { error: itemsError } = await admin
      .from("order_items")
      .insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
    if (itemsError) {
      await admin.from("orders").delete().eq("id", order.id);
      throw itemsError;
    }

    // Best effort — never fails the request.
    const folio = order.id.slice(0, 8);
    const lines = orderItems
      .map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`)
      .join("");
    await sendEmail({
      to: await listAdminEmails(admin),
      subject: `Nueva cotización #${folio}`,
      html: `<p>${escapeHtml(customerName || "Un cliente")} solicitó una cotización.</p>
<ul>${lines}</ul>
<p>Entrega: ${escapeHtml(deliverySlot)} — ${escapeHtml(deliveryAddress)}</p>
<p>Ábrela en la app (Pedidos → Cotizaciones) para revisarla y enviarla.</p>`,
    });

    return json({ orderId: order.id });
  } catch (error) {
    console.error("create-quote failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
