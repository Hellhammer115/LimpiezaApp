// MODEL — order-status domain rules: display labels, badge styles, state
// predicates and the single money formula shared by every screen that
// renders or edits an order/cotización.
import type {
  DiscountInput,
  FulfillmentStatus,
  Order,
  OrderStatus,
} from "@/models/types";

/** A row is a cotización until the webhook confirms payment. */
export const isQuote = (order: Pick<Order, "paid_at">) => order.paid_at === null;

/** Payment has been resolved one way or the other (webhook already ran). */
export const isPaymentSettled = (status: OrderStatus) => status !== "pending";

/** The order can never change again — stop polling. */
export const isFinal = (status: OrderStatus) =>
  status === "delivered" || status === "cancelled";

/** Customer may start (or resume) a Mercado Pago payment. */
export const canPay = (status: OrderStatus) =>
  status === "quote_sent" || status === "pending";

/** Customer may cancel; admin may reject / edit / send. */
export const canCancelQuote = (status: OrderStatus) =>
  status === "quote_requested" || status === "quote_sent";
export const isQuoteEditable = canCancelQuote;

const FULFILLMENT_NEXT: Partial<Record<OrderStatus, FulfillmentStatus>> = {
  paid: "preparing",
  preparing: "delivering",
  delivering: "delivered",
};

/** The one status an admin may advance a paid order to, or null. */
export const nextFulfillmentStatus = (status: OrderStatus) =>
  FULFILLMENT_NEXT[status] ?? null;

export interface Totals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

/**
 * The money rule, identical to apply_quote_edit in the database:
 * total = subtotal − discount + delivery fee, never below zero.
 * An amount discount larger than the subtotal is NOT clamped here — the server
 * rejects it, and the editor caps the input. Used for live totals in the admin
 * editor; the server result is authoritative.
 */
export function computeTotals(input: {
  items: { quantity: number; unit_price_cents: number }[];
  discount: DiscountInput;
  deliveryFeeCents: number;
}): Totals {
  const subtotal = input.items.reduce(
    (sum, i) => sum + i.quantity * i.unit_price_cents,
    0
  );
  const discount =
    input.discount.type === "percent"
      ? Math.round((subtotal * input.discount.value) / 100)
      : input.discount.cents;
  const total = Math.max(subtotal - discount + input.deliveryFeeCents, 0);
  return { subtotal, discount, deliveryFee: input.deliveryFeeCents, total };
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  quote_requested: "Nueva cotización",
  quote_sent: "Cotización enviada",
  pending: "Pago pendiente",
  paid: "Pagado",
  preparing: "Preparando",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/** [badge background class, badge text class] */
export const STATUS_STYLES: Record<OrderStatus, [string, string]> = {
  quote_requested: ["bg-citrus/20", "text-citrus"],
  quote_sent: ["bg-tide/15", "text-tide"],
  pending: ["bg-citrus/20", "text-citrus"],
  paid: ["bg-primary/15", "text-primary"],
  preparing: ["bg-tide/15", "text-tide"],
  delivering: ["bg-tide/15", "text-tide"],
  delivered: ["bg-primary/15", "text-primary"],
  cancelled: ["bg-coral/15", "text-coral"],
};

export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  preparing: "Preparando",
  delivering: "En camino",
  delivered: "Entregado",
};
