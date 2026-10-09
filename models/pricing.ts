// MODEL — wholesale (mayoreo) pricing. Each complete group of 12 pieces costs
// the dozen price; the remainder costs the per-piece price. Display mirror of
// public.line_total_cents (20261007130000_dozen_pricing.sql) and
// supabase/functions/_shared/pricing.ts — the server result is authoritative.
import { formatMXN } from "@/utils/format";

export const DOZEN = 12;

/** Line total in integer cents. A null/undefined dozen price means no mayoreo. */
export function lineTotalCents(
  quantity: number,
  unitPriceCents: number,
  dozenPriceCents: number | null | undefined
): number {
  if (dozenPriceCents == null) return quantity * unitPriceCents;
  return (
    Math.floor(quantity / DOZEN) * dozenPriceCents + (quantity % DOZEN) * unitPriceCents
  );
}

/**
 * "1 docena × $90.00 + 3 × $10.00" when the line includes at least one dozen,
 * otherwise null (the plain "qty × price" needs no explanation).
 */
export function lineBreakdown(
  quantity: number,
  unitPriceCents: number,
  dozenPriceCents: number | null | undefined
): string | null {
  if (dozenPriceCents == null || quantity < DOZEN) return null;
  const dozens = Math.floor(quantity / DOZEN);
  const rest = quantity % DOZEN;
  const head = `${dozens} ${dozens === 1 ? "docena" : "docenas"} × ${formatMXN(dozenPriceCents)}`;
  return rest ? `${head} + ${rest} × ${formatMXN(unitPriceCents)}` : head;
}
