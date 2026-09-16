import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useOrders } from "@/controllers/useOrders";
import type { OrderKind } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { OrderCard } from "@/views/OrderCard";

const FILTERS: { kind: OrderKind; label: string }[] = [
  { kind: "quotes", label: "Cotizaciones" },
  { kind: "orders", label: "Pedidos" },
];

/**
 * VIEW — Pedidos tab: the signed-in user's own cotizaciones and pedidos.
 * Admins see everyone's rows in the admin section, not here.
 */
export default function Orders() {
  const [kind, setKind] = useState<OrderKind>("quotes");
  const query = useOrders(kind);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <Text className="px-5 pt-4 font-quicksand-bold text-2xl text-dark-100">Mis pedidos</Text>

      <View className="flex-row px-5 pb-1 pt-3">
        {FILTERS.map((f) => {
          const active = f.kind === kind;
          return (
            <Pressable key={f.kind} onPress={() => setKind(f.kind)} className={active ? "chip-active" : "chip"}>
              <Text className={`font-quicksand-semibold text-sm ${active ? "text-white" : "text-dark-100"}`}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3E8368" />
        </View>
      ) : (
        <FlatList
          data={query.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 py-4"
          refreshing={query.isRefetching}
          onRefresh={query.refetch}
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => router.push(`/order/${item.id}`)} />
          )}
          ListEmptyComponent={
            kind === "quotes" ? (
              <EmptyState
                icon="document-text-outline"
                title="Aún no tienes cotizaciones"
                subtitle="Confirma tu carrito para solicitar una"
              />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title="Aún no tienes pedidos"
                subtitle="Los pedidos pagados aparecen aquí"
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
