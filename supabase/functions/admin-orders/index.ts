// admin-orders: everything an admin does with cotizaciones and pedidos.
// Gated on admin_users; all writes use the service role. Line-item edits go
// through the apply_quote_edit RPC so totals are recomputed atomically and
// only while the row is still an unpaid quote.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { getCaller, requireAdmin } from "../_shared/auth.ts";
import { deliveryFeeCents } from "../_shared/delivery.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";

const ORDER_WITH_ITEMS = "*, order_items ( * )";

/** Upper bound for any money field ($999,999.99): keeps values inside int4. */
const MAX_CENTS = 99_999_999;

const discountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("amount"), cents: z.number().int().min(0).max(MAX_CENTS) }),
  z.object({ type: z.literal("percent"), value: z.number().int().min(0).max(100) }),
]);

const patchSchema = z.object({
  id: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        unit_price_cents: z.number().int().min(0).max(MAX_CENTS),
      })
    )
    .min(1)
    .max(50),
  delivery_fee_cents: z.number().int().min(0).max(MAX_CENTS),
  discount: discountSchema,
  admin_note: z.string().max(1000).nullable(),
});

const createSchema = z.object({
  id: z.string().uuid().optional(), // unused; keeps the discriminated union shape uniform
  action: z.literal("create"),
  userId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        unit_price_cents: z.number().int().min(0).max(MAX_CENTS),
      })
    )
    .min(1)
    .max(50),
  delivery_fee_cents: z.number().int().min(0).max(MAX_CENTS),
  discount: discountSchema,
  admin_note: z.string().max(1000).nullable(),
});

const actionSchema = z.discriminatedUnion("action", [
  createSchema,
  z.object({ id: z.string().uuid(), action: z.literal("send") }),
  z.object({ id: z.string().uuid(), action: z.literal("reject"), note: z.string().max(1000).optional() }),
  z.object({ id: z.string().uuid(), action: z.literal("delete") }),
  z.object({
    id: z.string().uuid(),
    action: z.literal("advance"),
    to: z.enum(["preparing", "delivering", "delivered"]),
  }),
]);

/** The only legal fulfillment steps, keyed by the status they start from. */
const NEXT_STATUS: Record<string, string> = {
  paid: "preparing",
  preparing: "delivering",
  delivering: "delivered",
};

Deno.serve(async (req) => {
  try {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { admin, user } = caller;
    if (!(await requireAdmin(admin, user.id))) return json({ error: "Prohibido" }, 403);

    const fetchOrder = async (id: string) => {
      const { data, error } = await admin
        .from("orders")
        .select(ORDER_WITH_ITEMS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    if (req.method === "GET") {
      const params = new URL(req.url).searchParams;
      const kind = params.get("kind") === "orders" ? "orders" : "quotes";
      const search = params.get("search")?.trim();
      let query = admin
        .from("orders")
        .select(ORDER_WITH_ITEMS)
        .is("hidden_by_admin_at", null)
        .order("created_at", { ascending: false });
      query = kind === "orders" ? query.not("paid_at", "is", null) : query.is("paid_at", null);
      if (search) {
        query = query.or(
          `customer_name.ilike.%${search}%,customer_email.ilike.%${search}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return json(data);
    }

    if (req.method === "PATCH") {
      const parsed = patchSchema.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const { id, items, delivery_fee_cents, discount, admin_note } = parsed.data;

      const { error } = await admin.rpc("apply_quote_edit", {
        p_order_id: id,
        p_items: items,
        p_delivery_fee_cents: delivery_fee_cents,
        p_discount_cents: discount.type === "amount" ? discount.cents : 0,
        p_discount_percent: discount.type === "percent" ? discount.value : null,
        p_admin_note: admin_note,
      });
      if (error) {
        // P0001 / P0002 carry the RPC's user-facing Spanish message.
        if (error.code === "P0001" || error.code === "P0002") {
          return json({ error: error.message }, 409);
        }
        throw error;
      }
      return json(await fetchOrder(id));
    }

    if (req.method === "POST") {
      const parsed = actionSchema.safeParse(await req.json());
      if (!parsed.success) return json({ error: "Solicitud inválida" }, 400);
      const body = parsed.data;
      const now = new Date().toISOString();

      if (body.action === "create") {
        const productIds = body.items.map((i) => i.productId);
        if (new Set(productIds).size !== productIds.length) {
          return json({ error: "Producto repetido en la cotización" }, 409);
        }
        const [profileResult, productsResult] = await Promise.all([
          admin
            .from("profiles")
            .select("user_id, name, last_name, phone, email")
            .eq("user_id", body.userId)
            .maybeSingle(),
          admin
            .from("products")
            .select("id, name, price_cents, stock, is_active")
            .in("id", productIds),
        ]);
        const profile = profileResult.data;
        if (!profile) return json({ error: "Cliente no encontrado" }, 404);
        if (productsResult.error) throw productsResult.error;

        let subtotalCents = 0;
        const rows: {
          product_id: string;
          name: string;
          quantity: number;
          unit_price_cents: number;
          catalog_price_cents: number;
        }[] = [];
        for (const item of body.items) {
          const product = productsResult.data?.find((p) => p.id === item.productId);
          if (!product || !product.is_active) {
            return json({ error: "Un producto ya no está disponible" }, 409);
          }
          if (product.stock < item.quantity) {
            return json({ error: `Sin existencias: ${product.name}` }, 409);
          }
          subtotalCents += product.price_cents * item.quantity;
          rows.push({
            product_id: product.id,
            name: product.name,
            quantity: item.quantity,
            unit_price_cents: product.price_cents,
            catalog_price_cents: product.price_cents,
          });
        }
        const feeCents = deliveryFeeCents(subtotalCents);
        const customerName = [profile.name, profile.last_name].filter(Boolean).join(" ").trim();

        const { data: order, error: orderError } = await admin
          .from("orders")
          .insert({
            user_id: body.userId,
            address_id: null,
            delivery_address: "",
            delivery_slot: "",
            status: "quote_sent",
            quoted_at: now,
            quoted_by: user.id,
            created_by_admin: user.id,
            subtotal_cents: subtotalCents,
            discount_cents: 0,
            delivery_fee_cents: feeCents,
            total_cents: subtotalCents + feeCents,
            customer_name: customerName,
            customer_phone: profile.phone ?? null,
            customer_email: profile.email ?? "",
          })
          .select("id")
          .single();
        if (orderError) throw orderError;

        const { data: inserted, error: itemsError } = await admin
          .from("order_items")
          .insert(rows.map((r) => ({ ...r, order_id: order.id })))
          .select("id, product_id");
        if (itemsError || !inserted) {
          await admin.from("orders").delete().eq("id", order.id);
          throw itemsError ?? new Error("order_items insert returned nothing");
        }

        // The admin's prices/fee/discount/note go through the same atomic
        // totals RPC the editor uses.
        const byProduct = new Map(body.items.map((i) => [i.productId, i]));
        const { error: editError } = await admin.rpc("apply_quote_edit", {
          p_order_id: order.id,
          p_items: inserted.map((row) => ({
            id: row.id,
            quantity: byProduct.get(row.product_id)!.quantity,
            unit_price_cents: byProduct.get(row.product_id)!.unit_price_cents,
          })),
          p_delivery_fee_cents: body.delivery_fee_cents,
          p_discount_cents: body.discount.type === "amount" ? body.discount.cents : 0,
          p_discount_percent: body.discount.type === "percent" ? body.discount.value : null,
          p_admin_note: body.admin_note,
          // A brand-new quote has no earlier version for the customer to compare.
          p_track_revision: false,
        });
        if (editError) {
          await admin.from("orders").delete().eq("id", order.id);
          if (editError.code === "P0001" || editError.code === "P0002") {
            return json({ error: editError.message }, 409);
          }
          throw editError;
        }

        if (profile.email) {
          await sendEmail({
            to: [profile.email],
            subject: `Recibiste una cotización de LimpiezaApp (#${order.id.slice(0, 8)})`,
            html: `<p>Hola ${escapeHtml(customerName || "")},</p>
<p>Te enviamos una cotización. Ábrela en LimpiezaApp (Pedidos → Cotizaciones) para aceptarla, elegir tu dirección y pagarla, o rechazarla.</p>`,
          });
        }
        return json(await fetchOrder(order.id));
      }

      if (body.action === "send") {
        const { data: updated, error } = await admin
          .from("orders")
          .update({ status: "quote_sent", quoted_at: now, quoted_by: user.id, updated_at: now })
          .eq("id", body.id)
          .in("status", ["quote_requested", "quote_sent"])
          .select(
            "id, customer_email, customer_name, total_cents, created_by_admin, address_id, quote_updated_at, quote_update_seen_at"
          );
        if (error) throw error;
        const row = updated?.[0];
        if (!row) return json({ error: "La cotización ya no se puede enviar" }, 409);

        if (row.customer_email) {
          const total = (row.total_cents / 100).toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN",
          });
          // An admin-created quote the customer hasn't accepted can't be paid
          // yet: tell them to accept (choose address/slot) first.
          const nextStep =
            row.created_by_admin && !row.address_id
              ? "para aceptarla, elegir tu dirección y pagarla, o rechazarla."
              : "para revisarla y pagarla.";
          // An update the customer hasn't opened yet: the app shows what changed.
          const revised =
            !!row.quote_updated_at &&
            (!row.quote_update_seen_at ||
              Date.parse(row.quote_update_seen_at) < Date.parse(row.quote_updated_at));
          await sendEmail({
            to: [row.customer_email],
            subject: revised
              ? `Tu cotización #${row.id.slice(0, 8)} fue actualizada`
              : `Tu cotización #${row.id.slice(0, 8)} está lista`,
            html: `<p>Hola ${escapeHtml(row.customer_name || "")},</p>
<p>${revised ? "Actualizamos tu cotización; el nuevo total es" : "Tu cotización está lista por un total de"} <strong>${total}</strong>.</p>${revised ? "<p>En la app verás la cotización anterior junto a la nueva para revisar qué cambió.</p>" : ""}
<p>Ábrela en LimpiezaApp (Pedidos → Cotizaciones) ${nextStep}</p>`,
          });
        }
        return json(await fetchOrder(body.id));
      }

      if (body.action === "reject") {
        // An omitted/empty note keeps whatever note was saved through PATCH
        // (Android has no Alert.prompt, so the admin writes the reason there).
        const note = body.note?.trim();
        const { data: updated, error } = await admin
          .from("orders")
          .update({
            status: "cancelled",
            ...(note ? { admin_note: note } : {}),
            updated_at: now,
          })
          .eq("id", body.id)
          .in("status", ["quote_requested", "quote_sent"])
          .select("id");
        if (error) throw error;
        if (!updated || updated.length === 0) {
          return json({ error: "La cotización ya no se puede rechazar" }, 409);
        }
        return json(await fetchOrder(body.id));
      }

      if (body.action === "delete") {
        // "Delete" hides the row from the admin list only; the customer keeps
        // seeing it until they hide it too, at which point the row is removed.
        const { data: hidden, error } = await admin
          .from("orders")
          .update({ hidden_by_admin_at: now })
          .eq("id", body.id)
          .eq("status", "cancelled")
          .is("paid_at", null)
          .select("id, hidden_by_customer_at");
        if (error) throw error;
        const row = hidden?.[0];
        if (!row) {
          return json({ error: "Solo se pueden eliminar cotizaciones canceladas" }, 409);
        }
        if (row.hidden_by_customer_at) {
          // Both sides hid it: physically remove (order_items cascade).
          await admin.from("orders").delete().eq("id", body.id);
        }
        return json({ ok: true });
      }

      // advance: only the single next step, guarded by the current status.
      const from = Object.keys(NEXT_STATUS).find((k) => NEXT_STATUS[k] === body.to)!;
      const { data: updated, error } = await admin
        .from("orders")
        .update({ status: body.to, updated_at: now })
        .eq("id", body.id)
        .eq("status", from)
        .select("id");
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return json({ error: "El pedido no está en el estado esperado" }, 409);
      }
      return json(await fetchOrder(body.id));
    }

    return json({ error: "Método no permitido" }, 405);
  } catch (error) {
    console.error("admin-orders failed", error);
    return json({ error: "Error interno" }, 500);
  }
});
