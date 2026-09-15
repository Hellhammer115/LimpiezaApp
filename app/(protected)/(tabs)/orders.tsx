import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIsAdmin } from "@/controllers/useAdmin";
import { useAdminOrders } from "@/controllers/useAdminOrders";
import { useOrders } from "@/controllers/useOrders";
import type { Order, OrderKind } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { OrderCard } from "@/views/OrderCard";

const FILTERS: { kind: OrderKind; label: string }[] = [
  { kind: "quotes", label: "Cotizaciones" },
  { kind: "orders", label: "Pedidos" },
];

/**
 * VIEW — Pedidos tab. Customers see their own rows; admins see everyone's.
 * The Cotizaciones | Pedidos filter is the same for both roles.
 */
export default function Orders() {
  const [kind, setKind] = useState<OrderKind>("quotes");
  const { data: isAdmin } = useIsAdmin();
  return isAdmin ? (
    <OrdersScreen kind={kind} onKind={setKind} admin />
  ) : (
    <OrdersScreen kind={kind} onKind={setKind} />
  );
}

function OrdersScreen({
  kind,
  onKind,
  admin = false,
}: {
  kind: OrderKind;
  onKind: (k: OrderKind) => void;
  admin?: boolean;
}) {
  // Both hooks are always called (rules of hooks); the flag disables the
  // query that doesn't apply to this role so only one request is made.
  const customer = useOrders(kind, !admin);
  const adminList = useAdminOrders(kind, undefined, admin);
  const query = admin ? adminList : customer;
  const rows: Order[] = query.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <Text className="px-5 pt-4 font-quicksand-bold text-2xl text-dark-100">
        {admin ? "Pedidos" : "Mis pedidos"}
      </Text>

      <View className="flex-row px-5 pb-1 pt-3">
        {FILTERS.map((f) => {
          const active = f.kind === kind;
          return (
            <Pressable key={f.kind} onPress={() => onKind(f.kind)} className={active ? "chip-active" : "chip"}>
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
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 py-4"
          refreshing={query.isRefetching}
          onRefresh={query.refetch}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              showCustomer={admin}
              onPress={() =>
                router.push(admin ? `/admin/order/${item.id}` : `/order/${item.id}`)
              }
            />
          )}
          ListEmptyComponent={
            kind === "quotes" ? (
              <EmptyState
                icon="document-text-outline"
                title={admin ? "Sin cotizaciones" : "Aún no tienes cotizaciones"}
                subtitle={admin ? "Las solicitudes nuevas aparecerán aquí" : "Confirma tu carrito para solicitar una"}
              />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title={admin ? "Sin pedidos" : "Aún no tienes pedidos"}
                subtitle="Los pedidos pagados aparecen aquí"
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
