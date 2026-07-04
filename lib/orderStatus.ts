import type { OrderStatus } from "@/lib/types";

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
