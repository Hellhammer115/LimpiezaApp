import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { formatDate, formatMXN } from "@/lib/format";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/orderStatus";
import { useOrder } from "@/lib/queries";

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id, {
    // Keep polling while payment is being confirmed.
    refetchInterval: 5000,
  });

  if (isLoading || !order) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-mist">
        <ActivityIndicator color="#3E8368" />
      </SafeAreaView>
    );
  }

  const [badgeBg, badgeText] = STATUS_STYLES[order.status];

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <ScreenHeader title={`Pedido #${order.id.slice(0, 8)}`} />
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="rounded-2xl bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-quicksand-medium text-sm text-dark-100/60">
              {formatDate(order.created_at)}
            </Text>
            <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
              <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
                {STATUS_LABELS[order.status]}
              </Text>
            </View>
          </View>
          <Text className="mt-2 font-quicksand-bold text-dark-100">
            {order.delivery_slot}
          </Text>
          {order.addresses ? (
            <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
              {order.addresses.label} · {order.addresses.street},{" "}
              {order.addresses.city}
            </Text>
          ) : null}
        </View>

        <Text className="mb-2 mt-6 font-quicksand-bold text-lg text-dark-100">
          Productos
        </Text>
        <View className="rounded-2xl bg-white p-4">
          {order.order_items.map((item) => (
            <View key={item.id} className="mb-2 flex-row justify-between">
              <Text
                numberOfLines={1}
                className="flex-1 pr-3 font-quicksand-medium text-sm text-dark-100/80"
              >
                {item.quantity}× {item.products?.name ?? "Producto"}
              </Text>
              <Text className="font-quicksand-semibold text-sm text-dark-100">
                {formatMXN(item.unit_price_cents * item.quantity)}
              </Text>
            </View>
          ))}
          <View className="mt-2 border-t border-dark-100/5 pt-2">
            <View className="flex-row justify-between">
              <Text className="font-quicksand-medium text-dark-100/60">
                Subtotal
              </Text>
              <Text className="font-quicksand-semibold text-dark-100">
                {formatMXN(order.subtotal_cents)}
              </Text>
            </View>
            <View className="mt-1 flex-row justify-between">
              <Text className="font-quicksand-medium text-dark-100/60">
                Envío
              </Text>
              <Text className="font-quicksand-semibold text-dark-100">
                {order.delivery_fee_cents === 0
                  ? "Gratis"
                  : formatMXN(order.delivery_fee_cents)}
              </Text>
            </View>
            <View className="mt-1 flex-row justify-between">
              <Text className="font-quicksand-bold text-base text-dark-100">
                Total
              </Text>
              <Text className="font-quicksand-bold text-base text-dark-100">
                {formatMXN(order.total_cents)}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
