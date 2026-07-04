import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { DELIVERY_SLOTS, deliveryFeeCents } from "@/lib/delivery";
import { formatMXN } from "@/lib/format";
import { createOrder, openMercadoPagoCheckout } from "@/lib/payments";
import { useAddresses } from "@/lib/queries";
import { cartSubtotalCents, useCart } from "@/store/cart";

export default function Checkout() {
  const items = useCart((s) => s.items);
  const { data: addresses } = useAddresses();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [slot, setSlot] = useState(DELIVERY_SLOTS[0]);
  const [paying, setPaying] = useState(false);

  // Preselect the default (or only) address.
  useEffect(() => {
    if (!addressId && addresses && addresses.length > 0) {
      const preferred = addresses.find((a) => a.is_default) ?? addresses[0];
      setAddressId(preferred.id);
    }
  }, [addresses, addressId]);

  const subtotal = cartSubtotalCents(items);
  const deliveryFee = deliveryFeeCents(subtotal);
  const total = subtotal + deliveryFee;

  const pay = async () => {
    if (!addressId) {
      Alert.alert("Falta dirección", "Agrega una dirección de entrega.");
      return;
    }
    if (items.length === 0) {
      router.back();
      return;
    }
    setPaying(true);
    try {
      const { orderId, initPoint } = await createOrder({
        addressId,
        deliverySlot: slot,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      });
      // The webhook decides the real payment status; the result screen just
      // polls the order row. The cart is cleared there once it's paid.
      await openMercadoPagoCheckout(initPoint);
      router.replace({
        pathname: "/checkout/result",
        params: { order_id: orderId },
      });
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Intenta de nuevo."
      );
    } finally {
      setPaying(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <ScreenHeader title="Confirmar pedido" />
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
              onPress={() => setAddressId(address.id)}
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
          <View className="mt-2 border-t border-dark-100/5 pt-2">
            <View className="flex-row justify-between">
              <Text className="font-quicksand-medium text-dark-100/60">
                Subtotal
              </Text>
              <Text className="font-quicksand-semibold text-dark-100">
                {formatMXN(subtotal)}
              </Text>
            </View>
            <View className="mt-1 flex-row justify-between">
              <Text className="font-quicksand-medium text-dark-100/60">
                Envío
              </Text>
              <Text className="font-quicksand-semibold text-dark-100">
                {deliveryFee === 0 ? "Gratis" : formatMXN(deliveryFee)}
              </Text>
            </View>
            <View className="mt-1 flex-row justify-between">
              <Text className="font-quicksand-bold text-dark-100">Total</Text>
              <Text className="font-quicksand-bold text-dark-100">
                {formatMXN(total)}
              </Text>
            </View>
          </View>
        </View>

        <Text className="mt-3 text-center font-quicksand-medium text-xs text-dark-100/50">
          El total se calcula y cobra de forma segura en el servidor.
        </Text>
      </ScrollView>

      <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-3">
        <PrimaryButton
          title={`Pagar ${formatMXN(total)} con Mercado Pago`}
          onPress={pay}
          loading={paying}
          disabled={items.length === 0}
        />
      </View>
    </SafeAreaView>
  );
}
