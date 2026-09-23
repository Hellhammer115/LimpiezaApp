// Display-only values. The authoritative rule lives in
// supabase/functions/_shared/delivery.ts (used by create-quote) — keep both in sync.
export const FREE_DELIVERY_THRESHOLD_CENTS = 35000;
export const DELIVERY_FEE_CENTS = 3900;

// The delivery day is decided by an admin when the quote is sent and the
// customer pays — these are time-of-day windows only.
export const DELIVERY_SLOTS = [
  "9am – 12pm",
  "12pm – 3pm",
  "3pm – 6pm",
  "6pm – 9pm",
];

export function deliveryFeeCents(subtotalCents: number): number {
  return subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS
    ? 0
    : DELIVERY_FEE_CENTS;
}
