// MODEL — cotización document: pure HTML rendering of an order for the PDF
// export. No React Native imports; inline CSS only (expo-print renders it in
// a WebView). Money is formatted here from integer cents.
import { STATUS_LABELS } from "@/models/orderStatus";
import type { OrderWithItems } from "@/models/types";
import { formatDate, formatMXN } from "@/utils/format";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Builds the printable HTML for a cotización / pedido. */
export function buildQuoteHtml(order: OrderWithItems): string {
  const folio = order.id.slice(0, 8).toUpperCase();
  const title = order.paid_at ? "Pedido" : "Cotización";
  const rows = order.order_items
    .map(
      (i) => `<tr>
  <td class="qty">${i.quantity}</td>
  <td>${esc(i.name)}</td>
  <td class="num">${formatMXN(i.unit_price_cents)}</td>
  <td class="num">${formatMXN(i.unit_price_cents * i.quantity)}</td>
</tr>`
    )
    .join("");
  const discountLabel =
    order.discount_percent != null ? `Descuento (${order.discount_percent}%)` : "Descuento";
  const discountRow =
    order.discount_cents > 0
      ? `<tr><td colspan="3" class="label">${discountLabel}</td><td class="num">−${formatMXN(order.discount_cents)}</td></tr>`
      : "";
  const feeText = order.delivery_fee_cents === 0 ? "Gratis" : formatMXN(order.delivery_fee_cents);
  const note = order.admin_note
    ? `<section class="note"><h3>Nota</h3><p>${esc(order.admin_note)}</p></section>`
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #10241F; margin: 32px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #3E8368; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 22px; color: #3E8368; }
  h2 { margin: 4px 0 0; font-size: 16px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #3E8368; margin: 0 0 6px; }
  .meta { text-align: right; color: #55625E; }
  .cols { display: flex; gap: 24px; margin-bottom: 20px; }
  .cols section { flex: 1; }
  p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #55625E; border-bottom: 1px solid #DDE3E0; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #EEF2F0; vertical-align: top; }
  .qty { width: 40px; }
  .num { text-align: right; white-space: nowrap; }
  .label { text-align: right; color: #55625E; }
  tfoot td { border: none; }
  tfoot tr.total td { font-weight: bold; font-size: 15px; border-top: 2px solid #3E8368; }
  .note { margin-top: 20px; background: #F5F7F5; padding: 12px; border-radius: 8px; }
  footer { margin-top: 32px; font-size: 11px; color: #55625E; }
</style></head><body>
<header>
  <div><h1>LimpiezaApp</h1><h2>${title} #${folio}</h2></div>
  <div class="meta"><p>${esc(formatDate(order.created_at))}</p><p>${esc(STATUS_LABELS[order.status])}</p></div>
</header>
<div class="cols">
  <section><h3>Cliente</h3>
    <p>${esc(order.customer_name || "—")}</p>
    <p>${esc(order.customer_phone ?? "")}</p>
    <p>${esc(order.customer_email)}</p>
  </section>
  <section><h3>Entrega</h3>
    <p>${esc(order.delivery_address || "Por definir")}</p>
    <p>${esc(order.delivery_slot || "Por definir")}</p>
  </section>
</div>
<table>
  <thead><tr><th>Cant.</th><th>Producto</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="3" class="label">Subtotal</td><td class="num">${formatMXN(order.subtotal_cents)}</td></tr>
    ${discountRow}
    <tr><td colspan="3" class="label">Envío</td><td class="num">${feeText}</td></tr>
    <tr class="total"><td colspan="3" class="label">Total</td><td class="num">${formatMXN(order.total_cents)}</td></tr>
  </tfoot>
</table>
${note}
<footer>Precios en MXN. Esta cotización es válida hasta que el pedido sea confirmado y pagado en la app.</footer>
</body></html>`;
}
