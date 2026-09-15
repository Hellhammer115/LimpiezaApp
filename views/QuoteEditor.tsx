import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { computeTotals } from "@/models/orderStatus";
import type { DiscountInput, OrderWithItems, QuoteEditInput } from "@/models/types";
import { centsToInput, formatMXN, parseMXNInput } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";

export interface QuoteDraft {
  items: {
    id: string;
    name: string;
    catalog_price_cents: number;
    quantity: number;
    unit_price_cents: number;
  }[];
  deliveryFeeCents: number;
  discount: DiscountInput;
  adminNote: string;
}

/** Editable copy of an order for the admin editor. */
export function draftFromOrder(order: OrderWithItems): QuoteDraft {
  return {
    items: order.order_items.map((i) => ({
      id: i.id,
      name: i.name,
      catalog_price_cents: i.catalog_price_cents,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
    })),
    deliveryFeeCents: order.delivery_fee_cents,
    discount:
      order.discount_percent != null
        ? { type: "percent", value: order.discount_percent }
        : { type: "amount", cents: order.discount_cents },
    adminNote: order.admin_note ?? "",
  };
}

/** The PATCH body the admin-orders function expects. */
export function draftToInput(draft: QuoteDraft): QuoteEditInput {
  return {
    items: draft.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
    })),
    delivery_fee_cents: draft.deliveryFeeCents,
    discount: draft.discount,
    admin_note: draft.adminNote.trim() || null,
  };
}

interface Props {
  draft: QuoteDraft;
  onChange: (draft: QuoteDraft) => void;
}

/**
 * VIEW — controlled editor for an unpaid cotización: per-line quantity and
 * unit price (catalog price shown as a hint), remove line, delivery fee,
 * discount ($ or %), note, and live totals from the shared money rule.
 */
export function QuoteEditor({ draft, onChange }: Props) {
  const totals = computeTotals({
    items: draft.items,
    discount: draft.discount,
    deliveryFeeCents: draft.deliveryFeeCents,
  });
  const subtotal = totals.subtotal;

  const updateItem = (id: string, patch: Partial<QuoteDraft["items"][number]>) =>
    onChange({
      ...draft,
      items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  const removeItem = (id: string) =>
    onChange({ ...draft, items: draft.items.filter((i) => i.id !== id) });

  return (
    <View>
      <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Productos</Text>
      <View className="rounded-2xl bg-white p-4">
        {draft.items.map((item) => (
          <View key={item.id} className="mb-3 border-b border-dark-100/5 pb-3">
            <View className="flex-row items-start justify-between">
              <Text className="flex-1 pr-3 font-quicksand-bold text-sm text-dark-100">{item.name}</Text>
              <Pressable
                onPress={() => removeItem(item.id)}
                disabled={draft.items.length === 1}
                hitSlop={8}
                className={draft.items.length === 1 ? "opacity-30" : ""}
              >
                <Ionicons name="trash-outline" size={18} color="#FF6B4A" />
              </Pressable>
            </View>
            <View className="mt-2 flex-row items-center gap-3">
              <Stepper
                value={item.quantity}
                onChange={(q) => updateItem(item.id, { quantity: q })}
              />
              <View className="flex-1">
                <MoneyInput
                  cents={item.unit_price_cents}
                  onChange={(c) => updateItem(item.id, { unit_price_cents: c })}
                />
                <Text className="mt-0.5 font-quicksand-medium text-[11px] text-dark-100/50">
                  Catálogo: {formatMXN(item.catalog_price_cents)}
                </Text>
              </View>
              <Text className="min-w-[72px] text-right font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.quantity * item.unit_price_cents)}
              </Text>
            </View>
          </View>
        ))}

        <Text className="label mb-1">Envío</Text>
        <MoneyInput
          cents={draft.deliveryFeeCents}
          onChange={(c) => onChange({ ...draft, deliveryFeeCents: c })}
        />

        <Text className="label mb-1 mt-3">Descuento</Text>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            {draft.discount.type === "amount" ? (
              // Capped at the subtotal: apply_quote_edit rejects a larger discount.
              <MoneyInput
                cents={draft.discount.cents}
                onChange={(c) =>
                  onChange({ ...draft, discount: { type: "amount", cents: Math.min(c, subtotal) } })
                }
              />
            ) : (
              <TextInput
                value={String(draft.discount.value)}
                keyboardType="number-pad"
                onChangeText={(t) => {
                  const v = Math.min(100, Math.max(0, Number(t.replace(/[^0-9]/g, "")) || 0));
                  onChange({ ...draft, discount: { type: "percent", value: v } });
                }}
                className="input"
              />
            )}
          </View>
          <View className="flex-row rounded-full bg-foam p-0.5">
            {(["amount", "percent"] as const).map((type) => {
              const active = draft.discount.type === type;
              return (
                <Pressable
                  key={type}
                  onPress={() =>
                    onChange({
                      ...draft,
                      discount: type === "amount" ? { type, cents: 0 } : { type, value: 0 },
                    })
                  }
                  className={`rounded-full px-3 py-1.5 ${active ? "bg-primary" : ""}`}
                >
                  <Text className={`font-quicksand-bold text-sm ${active ? "text-white" : "text-dark-100"}`}>
                    {type === "amount" ? "$" : "%"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text className="label mb-1 mt-3">Nota para el cliente</Text>
        <TextInput
          value={draft.adminNote}
          onChangeText={(t) => onChange({ ...draft, adminNote: t })}
          placeholder="Opcional"
          placeholderTextColor="rgba(16,36,31,0.35)"
          multiline
          className="input min-h-[64px]"
        />

        <OrderTotals
          subtotal={totals.subtotal}
          discount={totals.discount}
          discountPercent={draft.discount.type === "percent" ? draft.discount.value : null}
          deliveryFee={totals.deliveryFee}
          total={totals.total}
        />
      </View>
    </View>
  );
}

/** Local +/− control (the cart's QuantityStepper is bound to the cart store). */
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full bg-foam px-1 py-0.5">
      <Pressable
        onPress={() => onChange(Math.max(1, value - 1))}
        className="size-8 items-center justify-center rounded-full bg-white"
        hitSlop={6}
      >
        <Ionicons name="remove" size={16} color="#10241F" />
      </Pressable>
      <Text className="min-w-5 text-center font-quicksand-bold text-sm text-dark-100">{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(99, value + 1))}
        className="size-8 items-center justify-center rounded-full bg-primary"
        hitSlop={6}
      >
        <Ionicons name="add" size={16} color="white" />
      </Pressable>
    </View>
  );
}

/**
 * Pesos text input that reports integer cents. Keeps its own text while
 * focused so "12." and "12.5" can be typed; commits on every valid parse.
 */
function MoneyInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(centsToInput(cents));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : centsToInput(cents);
  return (
    <TextInput
      value={shown}
      keyboardType="decimal-pad"
      onFocus={() => {
        setText(centsToInput(cents));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChangeText={(t) => {
        setText(t);
        const parsed = parseMXNInput(t);
        if (parsed !== null) onChange(parsed);
      }}
      className="input"
    />
  );
}
