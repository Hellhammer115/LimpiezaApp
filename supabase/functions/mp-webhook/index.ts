// mp-webhook: the single source of truth for payment status.
// Deployed with verify_jwt = false (Mercado Pago calls it server-to-server);
// it authenticates requests by validating the x-signature HMAC and never
// trusts the notification body — it re-fetches the payment from MP's API.
// Idempotent: repeated notifications cannot double-fulfill an order.
import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function isValidSignature(
  req: Request,
  dataId: string,
  secret: string
): Promise<boolean> {
  const signatureHeader = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";

  const parts = new Map(
    signatureHeader
      .split(",")
      .map((part) => part.split("=", 2).map((s) => s.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2)
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  // Manifest format defined by Mercado Pago; alphanumeric ids are lowercased.
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, v1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  try {
    const secret = Deno.env.get("MP_WEBHOOK_SECRET");
    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!secret || !mpToken) {
      console.error("MP secrets not configured");
      return new Response(null, { status: 503 });
    }

    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? url.searchParams.get("topic");
    const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

    // Only payment notifications are relevant; acknowledge everything else.
    if (type !== "payment" || !dataId) {
      return new Response(null, { status: 200 });
    }

    if (!(await isValidSignature(req, dataId, secret))) {
      console.error("Invalid webhook signature");
      return new Response(null, { status: 401 });
    }

    // Never trust the notification body: fetch the payment from MP directly.
    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${dataId}`,
      { headers: { Authorization: `Bearer ${mpToken}` } }
    );
    if (!paymentResponse.ok) {
      console.error("Failed to fetch payment", paymentResponse.status);
      // 5xx so Mercado Pago retries later.
      return new Response(null, { status: 502 });
    }
    const payment = await paymentResponse.json();

    const orderId: string | undefined = payment.external_reference;
    if (!orderId) return new Response(null, { status: 200 });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: order } = await admin
      .from("orders")
      .select("id, status")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return new Response(null, { status: 200 });

    // Idempotency: only a pending order can transition.
    if (order.status !== "pending") return new Response(null, { status: 200 });

    if (payment.status === "approved") {
      const { data: updated } = await admin
        .from("orders")
        .update({ status: "paid", mp_payment_id: String(payment.id) })
        .eq("id", orderId)
        .eq("status", "pending") // guard against concurrent notifications
        .select("id");
      if (updated && updated.length > 0) {
        await admin.rpc("decrement_stock_for_order", { p_order_id: orderId });
      }
    } else if (["rejected", "cancelled"].includes(payment.status)) {
      await admin
        .from("orders")
        .update({ status: "cancelled", mp_payment_id: String(payment.id) })
        .eq("id", orderId)
        .eq("status", "pending");
    }
    // pending / in_process: leave the order as pending.

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("mp-webhook failed", error);
    return new Response(null, { status: 500 });
  }
});
