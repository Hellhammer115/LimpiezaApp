// VIEW — customer accepts an admin-created cotización: picks address + slot,
// then "Aceptar y pagar" records them and starts the payment.
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAddresses } from "@/controllers/useAddresses";
import { useOrder } from "@/controllers/useOrders";
import { useAcceptQuote, usePayQuote } from "@/controllers/useQuote";
import { DELIVERY_SLOTS } from "@/models/delivery";
import { needsAcceptance } from "@/models/orderStatus";
import { formatMXN } from "@/utils/format";
import { OrderTotals } from "@/views/OrderTotals";
import { PrimaryButton } from "@/views/PrimaryButton";
import { ScreenHeader } from "@/views/ScreenHeader";

export default function AcceptQuote() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const { data: addresses } = useAddresses();
  const accept = useAcceptQuote();
  const pay = usePayQuote();

  const [chosenId, setChosenId] = useState<string | null>(null);
  const [slot, setSlot] = useState(DELIVERY_SLOTS[0]);
  const preferredId = addresses?.find((a) => a.is_default)?.id ?? addresses?.[0]?.id ?? null;
  const addressId = addresses?.some((a) => a.id === chosenId) ? chosenId : preferredId;

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }
  // Already accepted (or not an admin quote): nothing to do here.
  if (!needsAcceptance(order)) return <Redirect href={`/order/${order.id}`} />;

  const acceptAndPay = async () => {
    if (!addressId) return;
    try {
      await accept.mutateAsync({ orderId: order.id, addressId, deliverySlot: slot });
    } catch {
      return; // the hook already alerted
    }
    try {
      await pay.mutateAsync(order.id); // navigates to the result screen on success
    } catch {
      router.replace(`/order/${order.id}`); // address saved; Pagar is available there
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Aceptar cotización" />
      <ScrollView contentContainerClassName="px-5 pb-6">
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
                <Text className="font-quicksand-bold text-dark-100">{address.label}</Text>
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
          <Text className="font-quicksand-bold text-sm text-primary">Agregar dirección</Text>
        </Pressable>

        <Text className="mb-2 font-quicksand-bold text-lg text-dark-100">Horario de entrega</Text>
        <View className="flex-row flex-wrap gap-2">
          {DELIVERY_SLOTS.map((s) => {
            const active = s === slot;
            return (
              <Pressable key={s} onPress={() => setSlot(s)} className={active ? "chip-active" : "chip"}>
                <Text
                  className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}
                >
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">Resumen</Text>
        <View className="rounded-2xl bg-white p-4">
          {order.order_items.map((item) => (
            <View key={item.id} className="mb-1 flex-row justify-between">
              <Text
                numberOfLines={1}
                className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/70"
              >
                {item.quantity}× {item.name}
              </Text>
              <Text className="font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.unit_price_cents * item.quantity)}
              </Text>
            </View>
          ))}
          <OrderTotals
            subtotal={order.subtotal_cents}
            discount={order.discount_cents}
            discountPercent={order.discount_percent}
            deliveryFee={order.delivery_fee_cents}
            total={order.total_cents}
          />
        </View>
      </ScrollView>
      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title={`Aceptar y pagar ${formatMXN(order.total_cents)}`}
          onPress={acceptAndPay}
          loading={accept.isPending || pay.isPending}
          disabled={!addressId}
        />
      </View>
    </SafeAreaView>
  );
}
