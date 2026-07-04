// MODEL — order-status domain rules: display labels, badge styles, and
// state predicates shared by every screen that renders an order.
import type { OrderStatus } from "@/models/types";

/** Payment has been resolved one way or the other (webhook already ran). */
export const isPaymentSettled = (status: OrderStatus) => status !== "pending";

/** The order can never change again — stop polling. */
export const isFinal = (status: OrderStatus) =>
  status === "delivered" || status === "cancelled";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pago pendiente",
  paid: "Pagado",
  preparing: "Preparando",
  delivering: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/** [badge background class, badge text class] */
export const STATUS_STYLES: Record<OrderStatus, [string, string]> = {
  pending: ["bg-citrus/20", "text-citrus"],
  paid: ["bg-primary/15", "text-primary"],
  preparing: ["bg-tide/15", "text-tide"],
  delivering: ["bg-tide/15", "text-tide"],
  delivered: ["bg-primary/15", "text-primary"],
  cancelled: ["bg-coral/15", "text-coral"],
};
