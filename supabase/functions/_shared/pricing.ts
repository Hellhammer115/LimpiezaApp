// Wholesale pricing: each complete dozen costs the dozen price, the
// remainder costs the per-piece price. Mirrors public.line_total_cents
// (20261007130000_dozen_pricing.sql) and models/pricing.ts.
export function lineTotalCents(
  quantity: number,
  unitPriceCents: number,
  dozenPriceCents: number | null
): number {
  if (dozenPriceCents === null) return quantity * unitPriceCents;
  return Math.floor(quantity / 12) * dozenPriceCents + (quantity % 12) * unitPriceCents;
}
