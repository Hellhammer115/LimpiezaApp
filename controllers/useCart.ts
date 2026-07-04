// CONTROLLER — cart: the only door views use into the cart model.
// Selector-based hooks return primitives where possible so a cart change
// re-renders only the views that depend on the changed value.
import {
  cartCount,
  cartStore,
  cartSubtotalCents,
  type CartItem,
} from "@/models/cartStore";

export type { CartItem };

/** Subscribe to an arbitrary slice of the cart (same API as zustand). */
export const useCart = cartStore;

/** Whether one product is in the cart (re-renders only that card). */
export const useInCart = (productId: string) =>
  cartStore((s) => s.items.some((i) => i.productId === productId));

/** Total units in the cart — the badge number. */
export const useCartCount = () => cartStore((s) => cartCount(s.items));

/** Cart subtotal in integer cents (display only). */
export const useCartSubtotal = () =>
  cartStore((s) => cartSubtotalCents(s.items));
