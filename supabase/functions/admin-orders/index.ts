// admin-orders: everything an admin does with cotizaciones and pedidos.
// Gated on admin_users; all writes use the service role. Line-item edits go
// through the apply_quote_edit RPC so totals are recomputed atomically and
// only while the row is still an unpaid quote.
// Deployed with verify_jwt = true.
import { z } from "npm:zod@3";

import { getCaller, requireAdmin } from "../_shared/auth.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { json } from "../_shared/http.ts";

const ORDER_WITH_ITEMS = "*, order_items ( * )";

const patchSchema = z.object({
  id: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        unit_price_cents: z.number().int().min(0),
      })
    )
    .min(1)
    .max(50),
  delivery_fee_cents: z.number().int().min(0),
  discount: z.discriminatedUnion("type", [
    z.object({ type: z.literal("amount"), cents: z.number().int().min(0) }),
    z.object({ type: z.literal("percent"), value: z.number().int().min(0).max(100) }),
  ]),
  admin_note: z.string().max(1000).nullable(),
});

const actionSchema = z.discriminatedUnion("action", [
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

      if (body.action === "send") {
        const { data: updated, error } = await admin
          .from("orders")
          .update({ status: "quote_sent", quoted_at: now, quoted_by: user.id, updated_at: now })
          .eq("id", body.id)
          .in("status", ["quote_requested", "quote_sent"])
          .select("id, customer_email, customer_name, total_cents");
        if (error) throw error;
        const row = updated?.[0];
        if (!row) return json({ error: "La cotización ya no se puede enviar" }, 409);

        if (row.customer_email) {
          const total = (row.total_cents / 100).toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN",
          });
          await sendEmail({
            to: [row.customer_email],
            subject: `Tu cotización #${row.id.slice(0, 8)} está lista`,
            html: `<p>Hola ${escapeHtml(row.customer_name || "")},</p>
<p>Tu cotización está lista por un total de <strong>${total}</strong>.</p>
<p>Ábrela en LimpiezaApp (Pedidos → Cotizaciones) para revisarla y pagarla.</p>`,
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
