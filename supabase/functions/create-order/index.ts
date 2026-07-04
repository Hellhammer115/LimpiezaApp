// create-order: validates the cart server-side, recomputes every price from
// the database (client-sent amounts are never trusted), creates the order +
// items with the service role, and returns a Mercado Pago Checkout Pro URL.
// Deployed with verify_jwt = true — only authenticated users can call it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

// Keep in sync with lib/delivery.ts (display-only mirror in the app).
const FREE_DELIVERY_THRESHOLD_CENTS = 35000;
const DELIVERY_FEE_CENTS = 3900;

const checkoutSchema = z.object({
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpToken) {
      console.error("MP_ACCESS_TOKEN is not configured");
      return json({ error: "Pagos no configurados" }, 503);
    }

    // User-scoped client (RLS active) to identify the caller.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);
    const user = userData.user;

    const parsed = checkoutSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
    const { addressId, deliverySlot, items } = parsed.data;

    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      return json({ error: "Solicitud inválida" }, 400);
    }

    // The address must belong to the caller — checked through RLS.
    const { data: address } = await userClient
      .from("addresses")
      .select("id")
      .eq("id", addressId)
      .maybeSingle();
    if (!address) return json({ error: "Dirección no encontrada" }, 400);

    // Recompute all prices from the database.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, name, price_cents, stock, is_active")
      .in("id", productIds);
    if (productsError) throw productsError;

    let subtotalCents = 0;
    const orderItems: {
      product_id: string;
      quantity: number;
      unit_price_cents: number;
    }[] = [];
    const mpItems: {
      id: string;
      title: string;
      quantity: number;
      unit_price: number;
      currency_id: string;
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
        quantity: item.quantity,
        unit_price_cents: product.price_cents,
      });
      mpItems.push({
        id: product.id,
        title: product.name,
        quantity: item.quantity,
        unit_price: product.price_cents / 100,
        currency_id: "MXN",
      });
    }

    const deliveryFeeCents =
      subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS ? 0 : DELIVERY_FEE_CENTS;
    if (deliveryFeeCents > 0) {
      mpItems.push({
        id: "delivery",
        title: "Envío",
        quantity: 1,
        unit_price: deliveryFeeCents / 100,
        currency_id: "MXN",
      });
    }
    const totalCents = subtotalCents + deliveryFeeCents;

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        user_id: user.id,
        address_id: addressId,
        status: "pending",
        subtotal_cents: subtotalCents,
        delivery_fee_cents: deliveryFeeCents,
        total_cents: totalCents,
        delivery_slot: deliverySlot,
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

    const deepLink = `limpiezaapp://checkout/result?order_id=${order.id}`;
    const preferenceResponse = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mpToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": order.id,
        },
        body: JSON.stringify({
          items: mpItems,
          external_reference: order.id,
          notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
          back_urls: {
            success: deepLink,
            pending: deepLink,
            failure: deepLink,
          },
          statement_descriptor: "LIMPIEZAAPP",
          metadata: { order_id: order.id },
        }),
      }
    );
    if (!preferenceResponse.ok) {
      console.error("MP preference failed", await preferenceResponse.text());
      await admin.from("orders").delete().eq("id", order.id);
      return json({ error: "No se pudo iniciar el pago" }, 502);
    }
    const preference = await preferenceResponse.json();

    await admin
      .from("orders")
      .update({ mp_preference_id: preference.id })
      .eq("id", order.id);

    return json({ orderId: order.id, initPoint: preference.init_point });
  } catch (error) {
    console.error("create-order failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
