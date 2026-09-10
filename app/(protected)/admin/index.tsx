// VIEW — admin product list: search, active/inactive badges, create/edit entry points.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAdminProducts } from "@/controllers/useAdmin";
import { formatMXN } from "@/utils/format";
import { EmptyState } from "@/views/EmptyState";

export default function AdminProducts() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the query 300ms behind the keystrokes so we don't hammer the
  // admin-products Edge Function (it does a sequential per-editor email
  // lookup) on every character typed.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: products, isLoading } = useAdminProducts(debouncedSearch || undefined);

  return (
    <SafeAreaView className="flex-1 bg-mist" edges={["top"]}>
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <Text className="font-quicksand-bold text-2xl text-dark-100">Productos</Text>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => router.push("/admin/categories")}
            className="h-10 flex-row items-center gap-1.5 rounded-full bg-white px-3"
          >
            <Ionicons name="pricetag-outline" size={16} color="#3E8368" />
            <Text className="font-quicksand-semibold text-sm text-dark-100">Categorías</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/admin/product/new")}
            className="size-10 items-center justify-center rounded-full bg-primary"
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
        </View>
      </View>

      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar producto…"
          placeholderTextColor="rgba(16,36,31,0.35)"
          className="input"
        />
      </View>

      <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        {(products ?? []).map((product) => (
          <Pressable
            key={product.id}
            onPress={() => router.push(`/admin/product/${product.id}`)}
            className="mb-3 flex-row items-center justify-between rounded-2xl bg-white p-4"
          >
            <View className="flex-1 pr-3">
              <Text className="font-quicksand-bold text-dark-100">{product.name}</Text>
              <Text className="mt-0.5 font-quicksand-medium text-sm text-dark-100/60">
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
        ))}

        {!isLoading && products?.length === 0 ? (
          <EmptyState
            icon="cube-outline"
            title="Sin productos"
            subtitle="Crea el primero con el botón +"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
