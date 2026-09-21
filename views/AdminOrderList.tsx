import { router } from "expo-router";
import { ActivityIndicator, FlatList, View } from "react-native";

import { useAdminOrders } from "@/controllers/useAdminOrders";
import type { OrderKind } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { OrderCard } from "@/views/OrderCard";

interface Props {
  /** quotes = unpaid cotizaciones, orders = paid pedidos. */
  kind: OrderKind;
}

/** VIEW — admin panel listing every customer's cotizaciones or pedidos. */
export function AdminOrderList({ kind }: Props) {
  const query = useAdminOrders(kind);

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#3E8368" />
      </View>
    );
  }

  return (
    <FlatList
      data={query.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerClassName="px-5 py-4"
      refreshing={query.isRefetching}
      onRefresh={query.refetch}
      renderItem={({ item }) => (
        <OrderCard
          order={item}
          showCustomer
          onPress={() => router.push(`/admin/order/${item.id}`)}
        />
      )}
      ListEmptyComponent={
        kind === "quotes" ? (
          <EmptyState
            icon="document-text-outline"
            title="Sin cotizaciones"
            subtitle="Las solicitudes nuevas aparecerán aquí"
          />
        ) : (
          <EmptyState
            icon="receipt-outline"
            title="Sin pedidos"
            subtitle="Los pedidos pagados aparecen aquí"
          />
        )
      }
    />
  );
}
