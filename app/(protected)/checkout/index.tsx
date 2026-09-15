import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAddresses } from "@/controllers/useAddresses";
import { useCart, useCartSubtotal } from "@/controllers/useCart";
import { useCheckout } from "@/controllers/useCheckout";
import { DELIVERY_SLOTS, deliveryFeeCents } from "@/models/delivery";
import { formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { ScreenHeader } from "@/views/ScreenHeader";

/**
 * VIEW — checkout: address + delivery-slot pickers and the order summary.
 * The request itself is fully handled by the checkout controller; totals
 * shown here are estimates (the server recomputes and the admin may adjust
 * them).
 */
export default function Checkout() {
  const items = useCart((s) => s.items);
  const { data: addresses } = useAddresses();
  const { requestQuote, submitting } = useCheckout();

  // Only an explicit tap is stored; the effective selection is derived below.
  // Preselecting in an effect instead would commit one frame with nothing
  // selected and force a second render every time the query refetches.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [slot, setSlot] = useState(DELIVERY_SLOTS[0]);

  const preferredId =
    addresses?.find((a) => a.is_default)?.id ?? addresses?.[0]?.id ?? null;
  // Falls back to the preferred address both before the user picks one and
  // when their pick has since been deleted — otherwise a stale id would leave
  // nothing selected and still be handed to requestQuote().
  const addressId = addresses?.some((a) => a.id === chosenId)
    ? chosenId
    : preferredId;

  const subtotal = useCartSubtotal();
  const deliveryFee = deliveryFeeCents(subtotal);
  const total = subtotal + deliveryFee;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Solicitar cotización" />
      <ScrollView contentContainerClassName="px-5 pb-6">
        {/* Address */}
        <Text className="mb-2 mt-2 font-quicksand-bold text-lg text-dark-100">
          Dirección de entrega
        </Text>
        {(addresses ?? []).map((address) => {
          const selected = address.id === addressId;
          return (
            <Pressable
              key={address.id}
              onPress={() => setChosenId(address.id)}
              className={`mb-2 flex-row items-center rounded-2xl border bg-white p-4 ${
                selected ? "border-primary" : "border-transparent"
              }`}
            >
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? "#3E8368" : "rgba(16,36,31,0.3)"}
              />
              <View className="ml-3 flex-1">
                <Text className="font-quicksand-bold text-dark-100">
                  {address.label}
                </Text>
                <Text className="font-quicksand-medium text-sm text-dark-100/60">
                  {address.street}, {address.city}
                </Text>
              </View>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => router.push("/account/addresses")}
          className="mb-4 flex-row items-center gap-1"
        >
          <Ionicons name="add" size={16} color="#3E8368" />
          <Text className="font-quicksand-bold text-sm text-primary">
            Agregar dirección
          </Text>
        </Pressable>

        {/* Delivery slot */}
        <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">
          Horario de entrega
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {DELIVERY_SLOTS.map((s) => {
            const active = s === slot;
            return (
              <Pressable
                key={s}
                onPress={() => setSlot(s)}
                className={active ? "chip-active" : "chip"}
              >
                <Text
                  className={`font-quicksand-semibold text-sm ${
                    active ? "text-white" : "text-dark-100"
                  }`}
                >
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Summary */}
        <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">
          Resumen
        </Text>
        <View className="rounded-2xl bg-white p-4">
          {items.map((item) => (
            <View
              key={item.productId}
              className="mb-1 flex-row justify-between"
            >
              <Text
                numberOfLines={1}
                className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/70"
              >
                {item.quantity}× {item.name}
              </Text>
              <Text className="font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.priceCents * item.quantity)}
              </Text>
            </View>
          ))}
          <OrderTotals subtotal={subtotal} discount={0} deliveryFee={deliveryFee} total={total} />
        </View>

        <Text className="mt-3 text-center font-quicksand-medium text-xs text-dark-100/50">
          Un asesor confirmará precios y disponibilidad. Te avisaremos cuando tu
          cotización esté lista para pagar; el envío mostrado es estimado.
        </Text>
      </ScrollView>

      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title={`Solicitar cotización · ${formatMXN(total)}`}
          onPress={() => requestQuote(addressId, slot)}
          loading={submitting}
          disabled={items.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}
