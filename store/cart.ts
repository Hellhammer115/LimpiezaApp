import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Product } from "@/lib/types";

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

// Cart contents are not sensitive, so plain AsyncStorage is fine. Prices here
// are display-only: the create-order Edge Function recomputes everything from
// the database, so a stale or tampered cart can never change what is charged.
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],

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

      increment: (productId) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        })),

      decrement: (productId) =>
        set((state) => ({
          items: state.items
            .map((i) =>
              i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i
            )
            .filter((i) => i.quantity > 0),
        })),

      remove: (productId) =>
        set((state) => ({
          items: state.items.filter((i) => i.productId !== productId),
        })),

      clear: () => set({ items: [] }),
    }),
    {
      name: "limpieza-cart",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export const cartSubtotalCents = (items: CartItem[]) =>
  items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

export const cartCount = (items: CartItem[]) =>
  items.reduce((sum, i) => sum + i.quantity, 0);
