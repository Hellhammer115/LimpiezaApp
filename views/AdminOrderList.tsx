import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, TextInput, View } from "react-native";

import { useAdminOrders } from "@/controllers/useAdminOrders";
import type { OrderKind } from "@/models/types";
import { EmptyState } from "@/views/EmptyState";
import { OrderCard } from "@/views/OrderCard";

interface Props {
  /** quotes = unpaid cotizaciones, orders = paid pedidos. */
  kind: OrderKind;
}

/**
 * VIEW — admin panel listing every customer's cotizaciones or pedidos:
 * customer search + a virtualized list loaded 30 rows at a time as you
 * scroll (same pattern as AdminProductList).
 */
export function AdminOrderList({ kind }: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce 300ms so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, isRefetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAdminOrders(kind, debouncedSearch || undefined);

  return (
    <>
      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por cliente o correo…"
          placeholderTextColor="rgba(15,42,61,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
          className="input"
        />
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        refreshing={isRefetching && !isFetchingNextPage}
        onRefresh={() => void refetch()}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        initialNumToRender={10}
        windowSize={11}
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            showCustomer
            onPress={() => router.push(`/admin/order/${item.id}`)}
          />
        )}
        ListFooterComponent={
          isLoading || isFetchingNextPage ? <ActivityIndicator className="my-6" color="#1B87C9" /> : null
        }
        ListEmptyComponent={
          isLoading ? null : isError ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="No se pudo cargar la lista"
              subtitle="Desliza hacia abajo para reintentar"
            />
          ) : debouncedSearch ? (
            <EmptyState icon="search-outline" title="Sin resultados" subtitle="Prueba con otro nombre o correo" />
          ) : kind === "quotes" ? (
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
    </>
  );
}
