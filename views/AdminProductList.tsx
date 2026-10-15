import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";

import { useAdminProducts } from "@/controllers/useAdmin";
import type { AdminProduct } from "@/models/types";
import { formatMXN } from "@/utils/format";
import { EmptyState } from "@/views/EmptyState";

function ProductRow({ product }: { product: AdminProduct }) {
  return (
    <Pressable
      onPress={() => router.push(`/admin/product/${product.id}`)}
      className="mb-3 flex-row items-center justify-between rounded-2xl bg-white p-4"
    >
      <View className="flex-1 pr-3">
        <Text className="font-quicksand-bold text-dark-100">{product.name}</Text>
        <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
          {product.sku ? `${product.sku} · ` : ""}
          {formatMXN(product.price_cents)} · {product.stock} en existencia
        </Text>
      </View>
      <View
        className={`rounded-full px-2 py-0.5 ${product.is_active ? "bg-primary/15" : "bg-coral/15"}`}
      >
        <Text
          className={`font-quicksand-bold text-[10px] ${product.is_active ? "text-primary" : "text-coral"}`}
        >
          {product.is_active ? "Activo" : "Inactivo"}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * VIEW — admin product panel: search box + a virtualized list that loads
 * the catalog 50 products at a time as you scroll.
 */
export function AdminProductList() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the query 300ms behind the keystrokes so we don't hit the
  // admin-products Edge Function on every character typed.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: products, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useAdminProducts(debouncedSearch || undefined);

  return (
    <>
      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre o clave…"
          placeholderTextColor="rgba(15,42,61,0.35)"
          className="input"
        />
      </View>

      <FlatList
        data={products ?? []}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <ProductRow product={item} />}
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        initialNumToRender={15}
        windowSize={11}
        refreshing={false}
        onRefresh={() => void refetch()}
        ListFooterComponent={
          isLoading || isFetchingNextPage ? <ActivityIndicator className="my-6" color="#1B87C9" /> : null
        }
        ListEmptyComponent={
          isError ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="No se pudieron cargar los productos"
              subtitle="Desliza hacia abajo para reintentar"
            />
          ) : !isLoading ? (
            <EmptyState
              icon="cube-outline"
              title="Sin productos"
              subtitle={debouncedSearch ? "Prueba con otra búsqueda" : "Crea el primero con el botón +"}
            />
          ) : null
        }
      />
    </>
  );
}
