// MODEL — quote revisions: whether an admin changed a sent cotización and
// what changed between the version the customer last saw (previous_quote,
// stored by apply_quote_edit) and the current one.
import type { Order, OrderWithItems, QuoteSnapshot } from "@/models/types";

type RevisionFields = Pick<
  Order,
  "status" | "paid_at" | "previous_quote" | "quote_updated_at" | "quote_update_seen_at"
>;

/** Unpaid quote with an earlier version to compare against. */
export const hasQuoteRevision = (order: RevisionFields) =>
  order.paid_at === null && order.status !== "cancelled" && order.previous_quote !== null;

/** The customer hasn't opened the latest update yet — drives the list icon. */
export const hasUnseenQuoteUpdate = (order: RevisionFields) =>
  hasQuoteRevision(order) &&
  order.status === "quote_sent" &&
  order.quote_updated_at !== null &&
  (order.quote_update_seen_at === null ||
    Date.parse(order.quote_update_seen_at) < Date.parse(order.quote_updated_at));

export type LineChange = "added" | "removed" | "changed" | "same";

export interface LineDiff {
  key: string;
  name: string;
  before: { quantity: number; unit_price_cents: number } | null;
  after: { quantity: number; unit_price_cents: number } | null;
  change: LineChange;
}

export interface QuoteDiff {
  lines: LineDiff[];
  /** Line ids (current version) whose quantity or price changed, or that are new. */
  changedItemIds: Set<string>;
  discountChanged: boolean;
  deliveryFeeChanged: boolean;
  noteChanged: boolean;
  totalDelta: number;
}

/** Compares the previous snapshot with the current quote, matching lines by item id. */
export function diffQuote(previous: QuoteSnapshot, current: OrderWithItems): QuoteDiff {
  const currentById = new Map(current.order_items.map((i) => [i.id, i]));
  const previousIds = new Set(previous.items.map((i) => i.id));
  const lines: LineDiff[] = [];
  const changedItemIds = new Set<string>();

  for (const old of previous.items) {
    const now = currentById.get(old.id);
    const before = { quantity: old.quantity, unit_price_cents: old.unit_price_cents };
    if (!now) {
      lines.push({ key: old.id, name: old.name, before, after: null, change: "removed" });
      continue;
    }
    const after = { quantity: now.quantity, unit_price_cents: now.unit_price_cents };
    const changed =
      before.quantity !== after.quantity || before.unit_price_cents !== after.unit_price_cents;
    if (changed) changedItemIds.add(now.id);
    lines.push({ key: old.id, name: now.name, before, after, change: changed ? "changed" : "same" });
  }
  for (const item of current.order_items) {
    if (previousIds.has(item.id)) continue;
    changedItemIds.add(item.id);
    lines.push({
      key: item.id,
      name: item.name,
      before: null,
      after: { quantity: item.quantity, unit_price_cents: item.unit_price_cents },
      change: "added",
    });
  }

  return {
    lines,
    changedItemIds,
    discountChanged:
      previous.discount_cents !== current.discount_cents ||
      previous.discount_percent !== current.discount_percent,
    deliveryFeeChanged: previous.delivery_fee_cents !== current.delivery_fee_cents,
    noteChanged: (previous.admin_note ?? "") !== (current.admin_note ?? ""),
    totalDelta: current.total_cents - previous.total_cents,
  };
}
