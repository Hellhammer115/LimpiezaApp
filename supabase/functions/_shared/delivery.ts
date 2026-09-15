// Authoritative delivery fee rule. models/delivery.ts in the app is a
// display-only mirror — change both together.
export const FREE_DELIVERY_THRESHOLD_CENTS = 35000;
export const DELIVERY_FEE_CENTS = 3900;

export function deliveryFeeCents(subtotalCents: number): number {
  return subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS ? 0 : DELIVERY_FEE_CENTS;
}
