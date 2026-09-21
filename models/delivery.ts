// Display-only values. The authoritative rule lives in
// supabase/functions/_shared/delivery.ts (used by create-quote) — keep both in sync.
export const FREE_DELIVERY_THRESHOLD_CENTS = 35000;
export const DELIVERY_FEE_CENTS = 3900;

export const DELIVERY_SLOTS = [
  "Hoy, 6pm – 8pm",
  "Mañana, 9am – 11am",
  "Mañana, 12pm – 2pm",
  "Mañana, 6pm – 8pm",
];

export function deliveryFeeCents(subtotalCents: number): number {
  return subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS
    ? 0
    : DELIVERY_FEE_CENTS;
}
