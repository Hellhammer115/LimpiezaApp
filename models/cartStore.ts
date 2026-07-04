// MODEL — cart: client-side cart state, persisted across app restarts.
// Prices stored here are display-only snapshots taken when the item was
// added; the create-order Edge Function recomputes everything from the
// database, so a stale or tampered cart can never change what is charged.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Product } from "@/models/types";

export interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  unit: string;
  imageUrl: string | null;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  add: (product: Product, quantity?: number) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

/**
 * The cart store. Views access it through controllers/useCart — never
 * directly — so the persistence/shape can evolve without touching views.
 */
export const cartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],

      /** Adds a product, merging quantities when it is already in the cart. */
      add: (product, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.productId === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.productId === product.id
                  ? { ...i, quantity: i.quantity + quantity }
                  : i
              ),
            };
          }
          return {
            items: [
              ...state.items,
              {
                productId: product.id,
                name: product.name,
                priceCents: product.price_cents,
                unit: product.unit,
                imageUrl: product.image_url,
                quantity,
              },
            ],
          };
        }),

      /** Increases quantity by one. */
      increment: (productId) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        })),

      /** Decreases quantity by one, removing the line when it reaches zero. */
      decrement: (productId) =>
        set((state) => ({
          items: state.items
            .map((i) =>
              i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i
            )
            .filter((i) => i.quantity > 0),
        })),

      /** Removes a line entirely regardless of quantity. */
      remove: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.productId !== productId),
        })),

      /** Empties the cart (after a paid order, or on sign-out). */
      clear: () => set({ items: [] }),
    }),
    {
      name: "limpieza-cart",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/** Sum of line totals in integer cents. */
export const cartSubtotalCents = (items: CartItem[]) =>
  items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

/** Total number of units across all lines (the cart badge number). */
export const cartCount = (items: CartItem[]) =>
  items.reduce((sum, i) => sum + i.quantity, 0);
