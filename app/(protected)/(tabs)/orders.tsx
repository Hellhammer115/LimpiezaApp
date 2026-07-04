import { router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { formatDate, formatMXN } from "@/lib/format";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/orderStatus";
import { useOrders } from "@/lib/queries";

export default function Orders() {
  const { data: orders, isLoading, refetch, isRefetching } = useOrders();

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <Text className="px-5 pt-4 font-quicksand-bold text-2xl text-dark-100">
        Mis pedidos
      </Text>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3E8368" />
        </View>
      ) : (
        <FlatList
          data={orders ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 py-4"
          refreshing={isRefetching}
          onRefresh={refetch}
          renderItem={({ item }) => {
            const [badgeBg, badgeText] = STATUS_STYLES[item.status];
            return (
              <Pressable
                onPress={() => router.push(`/order/${item.id}`)}
                className="mb-3 rounded-2xl bg-white p-4"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="font-quicksand-bold text-dark-100">
                    Pedido #{item.id.slice(0, 8)}
                  </Text>
                  <View className={`rounded-full px-3 py-1 ${badgeBg}`}>
                    <Text className={`font-quicksand-bold text-xs ${badgeText}`}>
                      {STATUS_LABELS[item.status]}
                    </Text>
                  </View>
                </View>
                <Text className="mt-1 font-quicksand-medium text-sm text-dark-100/60">
                  {formatDate(item.created_at)}
                </Text>
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="font-quicksand-medium text-sm text-dark-100/60">
                    {item.delivery_slot}
                  </Text>
                  <Text className="font-quicksand-bold text-base text-dark-100">
                    {formatMXN(item.total_cents)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="Aún no tienes pedidos"
              subtitle="Cuando hagas tu primer pedido aparecerá aquí"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
