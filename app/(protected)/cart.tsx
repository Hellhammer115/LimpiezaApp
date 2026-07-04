import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QuantityStepper } from "@/components/QuantityStepper";
import { deliveryFeeCents } from "@/lib/delivery";
import { formatMXN } from "@/lib/format";
import { cartSubtotalCents, useCart } from "@/store/cart";

export default function Cart() {
  const items = useCart((s) => s.items);
  const remove = useCart((s) => s.remove);

  const subtotal = cartSubtotalCents(items);
  const deliveryFee = deliveryFeeCents(subtotal);
  const total = subtotal + deliveryFee;

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top", "bottom"]}>
      <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
        <Text className="font-quicksand-bold text-2xl text-dark-100">
          Mi carrito
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="size-9 items-center justify-center rounded-full bg-white"
          hitSlop={8}
        >
          <Ionicons name="close" size={20} color="#10241F" />
        </Pressable>
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="bag-outline"
          title="Tu carrito está vacío"
          subtitle="Agrega productos para empezar tu pedido"
        />
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.productId}
            contentContainerClassName="px-5 py-3"
            renderItem={({ item }) => (
              <View className="mb-3 flex-row items-center rounded-2xl bg-white p-3">
                <View className="size-16 items-center justify-center rounded-xl bg-foam">
                  {item.imageUrl ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={{ width: "100%", height: "100%", borderRadius: 12 }}
                      contentFit="cover"
                    />
                  ) : (
                    <Ionicons name="basket-outline" size={24} color="#3E8368" />
                  )}
                </View>
                <View className="ml-3 flex-1">
                  <Text
                    numberOfLines={2}
                    className="font-quicksand-semibold text-sm text-dark-100"
                  >
                    {item.name}
                  </Text>
                  <Text className="mt-0.5 font-quicksand-medium text-xs text-dark-100/50">
                    {formatMXN(item.priceCents)} · {item.unit}
                  </Text>
                  <Text className="mt-1 font-quicksand-bold text-dark-100">
                    {formatMXN(item.priceCents * item.quantity)}
                  </Text>
                </View>
                <View className="items-end gap-2">
                  <Pressable onPress={() => remove(item.productId)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color="#FF6B4A" />
                  </Pressable>
                  <QuantityStepper productId={item.productId} compact />
                </View>
              </View>
            )}
          />

          <View className="border-t border-dark-100/5 bg-white px-5 pb-4 pt-4">
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
              <Text
                className={`font-quicksand-semibold ${
                  deliveryFee === 0 ? "text-primary" : "text-dark-100"
                }`}
              >
                {deliveryFee === 0 ? "Gratis" : formatMXN(deliveryFee)}
              </Text>
            </View>
            <View className="mt-2 flex-row justify-between border-t border-dark-100/5 pt-2">
              <Text className="font-quicksand-bold text-lg text-dark-100">
                Total
              </Text>
              <Text className="font-quicksand-bold text-lg text-dark-100">
                {formatMXN(total)}
              </Text>
            </View>
            <View className="mt-4">
              <PrimaryButton
                title="Continuar"
                onPress={() => router.push("/checkout")}
              />
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
