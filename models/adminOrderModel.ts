// MODEL — admin orders: everyone's cotizaciones/pedidos, and the admin's
// actions on them. Every call goes through the admin-orders Edge Function
// (orders RLS stays client-read-only). Only used from admin-gated controllers.
import { invokeAdminFunction } from "@/models/adminModel";
import type {
  FulfillmentStatus,
  OrderKind,
  OrderWithItems,
  QuoteEditInput,
} from "@/models/types";

/** All rows of one kind (quotes = unpaid, orders = paid), newest first. */
export async function listAdminOrders(
  kind: OrderKind,
  search?: string
): Promise<OrderWithItems[]> {
  return invokeAdminFunction<OrderWithItems[]>("admin-orders", "GET", undefined, {
    kind,
    search,
  });
}

/** Replaces line items / fee / discount / note of an unpaid quote. */
export async function updateQuote(id: string, input: QuoteEditInput): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "PATCH", { id, ...input });
}

/** Marks the quote as sent (emails the customer). */
export async function sendQuote(id: string): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", { id, action: "send" });
}

/** Rejects an unpaid quote with an optional note shown to the customer. */
export async function rejectQuote(id: string, note?: string): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", {
    id,
    action: "reject",
    note,
  });
}

/** Advances a paid order one fulfillment step. */
export async function advanceOrder(
  id: string,
  to: FulfillmentStatus
): Promise<OrderWithItems> {
  return invokeAdminFunction<OrderWithItems>("admin-orders", "POST", {
    id,
    action: "advance",
    to,
  });
}
